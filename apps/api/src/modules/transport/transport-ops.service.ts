/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECTs, time zone, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  EndReplacementDto,
  PapersDto,
  ReplacementDto,
  ReplacementListDto,
} from './transport-desk.dto';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const PAPERS = `SELECT * FROM (
    SELECT 'vehicle' AS owner, v.id::text AS owner_id, v.reg_no AS name, v.name AS detail, 'insurance' AS kind, 'Insurance' AS paper, v.insurance_expiry AS on_date FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
    UNION ALL SELECT 'vehicle', v.id::text, v.reg_no, v.name, 'fitness', 'Fitness certificate', v.fitness_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
    UNION ALL SELECT 'vehicle', v.id::text, v.reg_no, v.name, 'permit', 'Permit', v.permit_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
    UNION ALL SELECT 'vehicle', v.id::text, v.reg_no, v.name, 'puc', 'PUC', v.puc_expiry FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active'
    UNION ALL SELECT 'crew', d.id::text, d.name, d.mobile, 'licence', 'Driving licence', d.licence_expiry FROM transport_drivers d WHERE d.deleted_at IS NULL AND d.status = 'active' AND d.role = 'driver'
  ) x`;

const REPLACEMENT = `SELECT x.id::text, COALESCE(x.number, 'RB-' || x.id::text) AS number, x.vehicle_id::text, v.reg_no AS vehicle, v.name AS vehicle_name,
       x.replacement_vehicle_id::text, rv.reg_no AS replacement, rv.name AS replacement_name, rv.capacity AS replacement_seats, v.capacity AS seats,
       x.driver_id::text, d.name AS driver, d.mobile AS driver_mobile, k.name AS conductor, k.mobile AS conductor_mobile, t.name AS attendant,
       x.from_date::text, x.to_date::text, x.reason, x.status, x.notified, x.notified_at, x.back_notified_at, x.ended_note, x.created_at,
       COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = x.created_by LIMIT 1), u.display_name) AS created_by,
       (rv.gps_device_id IS NOT NULL AND btrim(rv.gps_device_id) <> '') AS replacement_gps,
       CASE WHEN x.status = 'cancelled' THEN 'cancelled' WHEN ${TODAY} < x.from_date THEN 'upcoming' WHEN ${TODAY} > x.to_date THEN 'over' ELSE 'running' END AS phase,
       COALESCE((SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM transport_routes r WHERE r.deleted_at IS NULL
                   AND (r.vehicle_id = x.vehicle_id OR EXISTS (SELECT 1 FROM transport_route_vehicles m WHERE m.route_id = r.id AND m.vehicle_id = x.vehicle_id AND m.status = 'active'))), '') AS routes
  FROM transport_replacements x
  JOIN transport_vehicles v ON v.id = x.vehicle_id
  JOIN transport_vehicles rv ON rv.id = x.replacement_vehicle_id
  LEFT JOIN transport_drivers d ON d.id = x.driver_id
  LEFT JOIN transport_drivers k ON k.id = x.conductor_id
  LEFT JOIN transport_drivers t ON t.id = x.attendant_id
  LEFT JOIN users u ON u.id = x.created_by`;
const toReplacement = (x: Row) => ({
  id: String(x.id),
  number: String(x.number),
  vehicleId: String(x.vehicle_id),
  vehicle: String(x.vehicle),
  vehicleName: text(x.vehicle_name),
  replacementVehicleId: String(x.replacement_vehicle_id),
  replacement: String(x.replacement),
  replacementName: text(x.replacement_name),
  seats: x.seats === null ? null : Number(x.seats),
  replacementSeats: x.replacement_seats === null ? null : Number(x.replacement_seats),
  replacementGps: Boolean(x.replacement_gps),
  driver: text(x.driver),
  driverMobile: text(x.driver_mobile),
  conductor: text(x.conductor),
  conductorMobile: text(x.conductor_mobile),
  attendant: text(x.attendant),
  fromDate: String(x.from_date),
  toDate: String(x.to_date),
  reason: String(x.reason),
  status: String(x.status),
  /** running, upcoming, over or cancelled, by today. */
  phase: String(x.phase),
  routes: String(x.routes),
  notified: Number(x.notified ?? 0),
  notifiedAt: iso(x.notified_at),
  backNotifiedAt: iso(x.back_notified_at),
  endedNote: text(x.ended_note),
  createdBy: text(x.created_by),
  createdAt: iso(x.created_at)!,
});
export type ReplacementRow = ReturnType<typeof toReplacement>;

/**
 * Transport operations (0082): the papers of the fleet that run out, and replacement buses. A vehicle off
 * the road gets a replacement vehicle and crew for some days; the routes it runs follow the replacement
 * (live tracking too), the parents of those routes are told, and told again when the regular bus is back.
 */
@Injectable()
export class TransportOpsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- papers ---------------------------------------------------------------------------------------
  private papersWhere(q: PapersDto, params: unknown[]): string {
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace(/\?/g, `$${String(params.length)}`));
    };
    if (q.state === 'expired') where.push(`x.on_date < ${TODAY}`);
    else if (q.state === 'soon') add(`x.on_date BETWEEN ${TODAY} AND ${TODAY} + ?::int`, q.days);
    else if (q.state === 'valid') add(`x.on_date > ${TODAY} + ?::int`, q.days);
    else if (q.state === 'missing') where.push(`x.on_date IS NULL`);
    if (q.kind) add(`x.kind = ?`, q.kind);
    if (q.q) add(`concat_ws(' ', x.name, x.detail) ILIKE '%' || ? || '%'`, q.q);
    return where.length ? ` WHERE ${where.join(' AND ')}` : '';
  }

  /** Every paper of every vehicle and every driver's licence, with the days left. */
  async papers(ctx: RequestContext, q: PapersDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.papersWhere(q, params);
      const r = await c.query<Row>(
        `SELECT x.*, (x.on_date - ${TODAY})::int AS days_left FROM (${PAPERS}) x${w} ORDER BY x.on_date NULLS LAST, x.name LIMIT 2000`,
        params,
      );
      const counts = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE x.on_date < ${TODAY})::int AS expired,
                count(*) FILTER (WHERE x.on_date BETWEEN ${TODAY} AND ${TODAY} + $1::int)::int AS soon,
                count(*) FILTER (WHERE x.on_date > ${TODAY} + $1::int)::int AS valid,
                count(*) FILTER (WHERE x.on_date IS NULL)::int AS missing FROM (${PAPERS}) x`,
        [q.days],
      );
      const k = counts.rows[0] ?? {};
      return {
        data: r.rows.map((x) => ({
          owner: String(x.owner) as 'vehicle' | 'crew',
          ownerId: String(x.owner_id),
          name: String(x.name),
          detail: text(x.detail),
          kind: String(x.kind),
          paper: String(x.paper),
          validTill:
            x.on_date instanceof Date ? x.on_date.toISOString().slice(0, 10) : text(x.on_date),
          daysLeft: x.days_left === null || x.days_left === undefined ? null : Number(x.days_left),
        })),
        counts: {
          expired: Number(k.expired ?? 0),
          soon: Number(k.soon ?? 0),
          valid: Number(k.valid ?? 0),
          missing: Number(k.missing ?? 0),
        },
        days: q.days,
      };
    });
  }

  async papersExcel(ctx: RequestContext, q: PapersDto) {
    const { data } = await this.papers(ctx, q);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fleet papers');
    ws.addRow(['Vehicle or driver', 'Detail', 'Paper', 'Valid till', 'Days left', 'State']).font = {
      bold: true,
    };
    for (const p of data)
      ws.addRow([
        p.name,
        p.detail ?? '',
        p.paper,
        p.validTill ?? '',
        p.daysLeft ?? '',
        p.daysLeft === null
          ? 'Not recorded'
          : p.daysLeft < 0
            ? 'Expired'
            : p.daysLeft <= q.days
              ? 'Running out'
              : 'Valid',
      ]);
    ws.columns.forEach((col, i) => {
      col.width = i < 3 ? 24 : 14;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return {
      bytes: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
      filename: `fleet-papers-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  // ---- replacement buses ----------------------------------------------------------------------------
  private async find(c: PoolClient, id: string): Promise<ReplacementRow> {
    const r = await c.query<Row>(`${REPLACEMENT} WHERE x.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Replacement not found', { status: 404 });
    return toReplacement(r.rows[0]);
  }

  /** The parents of the routes the vehicle runs are told (email, and SMS / WhatsApp where the template is ready). */
  private async tell(c: PoolClient, x: ReplacementRow, over: boolean): Promise<number> {
    const school =
      (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]?.name ?? '';
    const mail = (
      await c.query<{ on: boolean }>(
        `SELECT COALESCE((SELECT notify_email FROM transport_settings WHERE school_id = app.current_school_id()), true) AS on`,
      )
    ).rows[0]!.on;
    const routes = await c.query<{ id: string; code: string; name: string }>(
      `SELECT r.id::text, r.code, r.name FROM transport_routes r WHERE r.deleted_at IS NULL
          AND (r.vehicle_id = $1 OR EXISTS (SELECT 1 FROM transport_route_vehicles m WHERE m.route_id = r.id AND m.vehicle_id = $1 AND m.status = 'active'))`,
      [x.vehicleId],
    );
    const back = new Date(`${x.toDate}T00:00:00Z`);
    back.setUTCDate(back.getUTCDate() + 1);
    const backDay = dayLabel(back.toISOString().slice(0, 10));
    let count = 0;
    for (const r of routes.rows) {
      const g = await c.query<{ mobile: string | null; email: string | null }>(
        `SELECT DISTINCT g.mobile, g.email::text FROM student_route_assignments a
           JOIN student_guardians sg ON sg.student_id = a.student_id AND sg.receives_notifications
           JOIN guardians g ON g.id = sg.guardian_id
          WHERE a.academic_year_id = app.current_academic_year_id() AND $1::bigint IN (a.route_id, a.drop_route_id)`,
        [r.id],
      );
      if (!g.rows.length) continue;
      const sent = await c.query<{ n: number }>(
        `SELECT app.template_to_mobiles($1, $2::text[], $3::jsonb) AS n`,
        [
          over ? 'transport_replacement_over' : 'transport_replacement',
          g.rows.map((y) => y.mobile).filter(Boolean),
          JSON.stringify({
            route: r.code,
            regular: x.vehicle,
            bus: x.replacement,
            driver: x.driver ?? '',
            mobile: x.driverMobile ?? '',
            from: over ? backDay : dayLabel(x.fromDate),
            to: dayLabel(x.toDate),
            school,
          }),
        ],
      );
      count += Number(sent.rows[0]?.n ?? 0);
      if (!mail) continue;
      for (const email of [
        ...new Set(g.rows.map((y) => y.email).filter((e): e is string => Boolean(e))),
      ]) {
        const q = await c.query<{ id: string | null }>(
          `SELECT app.queue_mail($1, $2, app.mail_card_html($3, $4, $5, $6, $7::jsonb, NULL, NULL, NULL), '[]'::jsonb,
                                 jsonb_build_object('transportReplacement', $8::text))::text AS id`,
          [
            email,
            over
              ? `Route ${r.code}: the regular bus is back`
              : `Route ${r.code}: replacement bus from ${dayLabel(x.fromDate)}`,
            school,
            over ? 'The regular bus is back' : 'A replacement bus runs your child’s route',
            over ? '#1B7F4B' : '#B26A00',
            over
              ? `Bus ${x.vehicle} runs route ${r.code} again from ${backDay}. Live tracking in the parent portal follows it.`
              : 'The regular bus is off the road for these days. The stops and timings do not change. Live tracking in the parent portal follows the replacement bus.',
            JSON.stringify(
              over
                ? [
                    ['Route', `${r.code} · ${r.name}`],
                    ['Regular bus', x.vehicle],
                    ['Back from', backDay],
                  ]
                : [
                    ['Route', `${r.code} · ${r.name}`],
                    ['Regular bus', x.vehicle],
                    [
                      'Replacement bus',
                      `${x.replacement}${x.replacementName ? ` (${x.replacementName})` : ''}`,
                    ],
                    [
                      'Driver',
                      x.driver
                        ? `${x.driver}${x.driverMobile ? ` · ${x.driverMobile}` : ''}`
                        : null,
                    ],
                    [
                      'Conductor',
                      x.conductor
                        ? `${x.conductor}${x.conductorMobile ? ` · ${x.conductorMobile}` : ''}`
                        : null,
                    ],
                    ['Attendant', x.attendant],
                    ['From', dayLabel(x.fromDate)],
                    ['To', dayLabel(x.toDate)],
                    ['Reason', x.reason],
                  ],
            ),
            x.id,
          ],
        );
        if (q.rows[0]?.id) count += 1;
      }
    }
    return count;
  }

  /** Replacements whose last day has passed: the parents hear once that the regular bus is back. */
  private async tick(c: PoolClient) {
    const due = await c.query<{ id: string }>(
      `SELECT id::text FROM transport_replacements WHERE status = 'active' AND to_date < ${TODAY} AND back_notified_at IS NULL
          AND notified_at IS NOT NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    for (const d of due.rows) {
      await this.tell(c, await this.find(c, d.id), true);
      await c.query(`UPDATE transport_replacements SET back_notified_at = now() WHERE id = $1`, [
        d.id,
      ]);
    }
  }

  async runTick(ctx: RequestContext) {
    await this.db.tenant(requireTenant(ctx), async (c) => this.tick(c));
  }

  async replacements(ctx: RequestContext, q: ReplacementListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.tick(c);
      const where =
        q.tab === 'now'
          ? `x.status = 'active' AND ${TODAY} BETWEEN x.from_date AND x.to_date`
          : q.tab === 'upcoming'
            ? `x.status = 'active' AND x.from_date > ${TODAY}`
            : q.tab === 'past'
              ? `(x.status = 'cancelled' OR x.to_date < ${TODAY})`
              : 'true';
      const r = await c.query<Row>(
        `${REPLACEMENT} WHERE ${where} ORDER BY x.from_date DESC, x.id DESC LIMIT 300`,
      );
      const counts = await c.query<Row>(
        `SELECT count(*) FILTER (WHERE status = 'active' AND ${TODAY} BETWEEN from_date AND to_date)::int AS now,
                count(*) FILTER (WHERE status = 'active' AND from_date > ${TODAY})::int AS upcoming FROM transport_replacements`,
      );
      return {
        data: r.rows.map(toReplacement),
        counts: {
          now: Number(counts.rows[0]?.now ?? 0),
          upcoming: Number(counts.rows[0]?.upcoming ?? 0),
        },
      };
    });
  }

  /** What the form offers: the vehicles (with the routes each runs) and the crew by role. */
  async replacementOptions(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const vehicles = await c.query<Row>(
        `SELECT v.id::text, v.reg_no, v.name, v.capacity, (v.gps_device_id IS NOT NULL AND btrim(v.gps_device_id) <> '') AS gps,
                COALESCE((SELECT string_agg(r.code, ', ' ORDER BY r.code) FROM transport_routes r WHERE r.deleted_at IS NULL
                   AND (r.vehicle_id = v.id OR EXISTS (SELECT 1 FROM transport_route_vehicles m WHERE m.route_id = r.id AND m.vehicle_id = v.id AND m.status = 'active'))), '') AS routes
           FROM transport_vehicles v WHERE v.deleted_at IS NULL AND v.status = 'active' ORDER BY v.reg_no`,
      );
      const crew = await c.query<Row>(
        `SELECT id::text, name, mobile, role FROM transport_drivers WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`,
      );
      return {
        vehicles: vehicles.rows.map((v) => ({
          id: String(v.id),
          regNo: String(v.reg_no),
          name: text(v.name),
          seats: v.capacity === null ? null : Number(v.capacity),
          gps: Boolean(v.gps),
          routes: String(v.routes),
        })),
        crew: crew.rows.map((p) => ({
          id: String(p.id),
          name: String(p.name),
          mobile: text(p.mobile),
          role: String(p.role),
        })),
      };
    });
  }

  async createReplacement(ctx: RequestContext, dto: ReplacementDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await c.query(
        `SELECT 1 FROM transport_vehicles WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [[dto.vehicleId, dto.replacementVehicleId]],
      );
      if (v.rowCount !== 2)
        throw new DomainError('not-found', 'Vehicle not found', { status: 404 });
      for (const [id, role] of [
        [dto.driverId, 'driver'],
        [dto.conductorId, 'conductor'],
        [dto.attendantId, 'attendant'],
      ] as const)
        if (id) {
          const p = await c.query(
            `SELECT 1 FROM transport_drivers WHERE id = $1 AND role = $2 AND deleted_at IS NULL`,
            [id, role],
          );
          if (!p.rowCount)
            throw new DomainError('validation-failed', `Choose a ${role} from the crew master`, {
              status: 400,
            });
        }
      const clash = await c.query<{ number: string }>(
        `SELECT COALESCE(number, 'RB-' || id::text) AS number FROM transport_replacements
          WHERE status = 'active' AND vehicle_id = $1 AND daterange(from_date, to_date, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
        [dto.vehicleId, dto.fromDate, dto.toDate],
      );
      if (clash.rows[0])
        throw new DomainError(
          'transport.replacement_overlap',
          `This vehicle already has a replacement for some of these days (${clash.rows[0].number}); end that one first`,
          { status: 409 },
        );
      const busy = await c.query<{ number: string }>(
        `SELECT COALESCE(number, 'RB-' || id::text) AS number FROM transport_replacements
          WHERE status = 'active' AND vehicle_id = $1 AND daterange(from_date, to_date, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
        [dto.replacementVehicleId, dto.fromDate, dto.toDate],
      );
      if (busy.rows[0])
        throw new DomainError(
          'transport.replacement_down',
          `The replacement vehicle is itself off the road on some of these days (${busy.rows[0].number})`,
          { status: 409 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO transport_replacements (school_id, vehicle_id, replacement_vehicle_id, driver_id, conductor_id, attendant_id, from_date, to_date, reason,
                                             created_by, updated_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date, $7::date, $8, app.current_user_id(), app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          dto.vehicleId,
          dto.replacementVehicleId,
          dto.driverId ?? null,
          dto.conductorId ?? null,
          dto.attendantId ?? null,
          dto.fromDate,
          dto.toDate,
          dto.reason,
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `UPDATE transport_replacements SET number = 'RB-' || to_char(created_at AT TIME ZONE ${TZ}, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE id = $1`,
        [id],
      );
      const n = await this.tell(c, await this.find(c, id), false);
      await c.query(
        `UPDATE transport_replacements SET notified = $2, notified_at = now() WHERE id = $1`,
        [id, n],
      );
      await this.audit.stage(ctx, c, {
        action: 'transport.replacement.create',
        entityType: 'transport_replacements',
        entityId: id,
        after: { ...dto, notified: n },
      });
      return this.find(c, id);
    });
  }

  /** The regular bus is back early (or the replacement is called off before it starts); the parents are told. */
  async endReplacement(ctx: RequestContext, id: string, dto: EndReplacementDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM transport_replacements WHERE id = $1 FOR UPDATE`, [id]);
      const x = await this.find(c, id);
      if (x.phase === 'over' || x.phase === 'cancelled')
        throw new DomainError('conflict', 'This replacement is already over', { status: 409 });
      if (x.phase === 'upcoming')
        await c.query(
          `UPDATE transport_replacements SET status = 'cancelled', ended_note = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, dto.note ?? 'Called off before it started'],
        );
      else
        // the last day of the replacement becomes yesterday (or its first day, when it started today)
        await c.query(
          `UPDATE transport_replacements SET to_date = GREATEST(from_date, ${TODAY} - 1), status = CASE WHEN from_date = ${TODAY} THEN 'cancelled' ELSE status END,
                  ended_note = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, dto.note ?? 'The regular bus is back'],
        );
      const after = await this.find(c, id);
      await this.tell(
        c,
        { ...after, toDate: x.phase === 'upcoming' ? x.fromDate : after.toDate },
        true,
      );
      await c.query(`UPDATE transport_replacements SET back_notified_at = now() WHERE id = $1`, [
        id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'transport.replacement.end',
        entityType: 'transport_replacements',
        entityId: id,
        after: { note: dto.note ?? null },
      });
      return this.find(c, id);
    });
  }
}
