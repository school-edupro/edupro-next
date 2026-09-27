import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import type { SendMessageDto } from '../comms/comms.dto';
import { MessagesService } from '../comms/messages.service';
import type { BusQueryDto, RfidIngestDto } from './attendance.dto';

export interface DeviceLookup {
  school_id: string;
  device_id: string;
  kind: string;
  route_id: string | null;
  direction: string | null;
}

/**
 * Bus attendance (S10, legacy attendance_bus + "Bus Attendance SMS"): taps on a bus reader record boarding
 * (in) and alighting (out) with the reader's position; the primary guardian gets one alert per tap when the
 * school has the `bus_boarded` / `bus_alighted` templates and the family has not withdrawn transport alerts.
 */
@Injectable()
export class BusService {
  private readonly log = new Logger(BusService.name);

  constructor(
    private readonly db: DbService,
    private readonly viewer: ViewerService,
    private readonly messages: MessagesService,
  ) {}

  /** Runs inside the device's tenant transaction (opened by RfidService.ingest). */
  async handle(c: PoolClient, ctx: RequestContext, lookup: DeviceLookup, dto: RfidIngestDto) {
    const outcomes: Record<string, number> = {};
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    for (const ev of dto.events) {
      const direction = ev.direction ?? lookup.direction ?? 'in';
      const st = await c.query<{
        id: string;
        name: string;
        guardian_user_id: string | null;
        guardian_mobile: string | null;
        stop: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, g.user_id::text AS guardian_user_id, g.mobile AS guardian_mobile,
                (SELECT a.stop_name FROM student_route_assignments a WHERE a.student_id = s.id AND a.route_id = $2::bigint ORDER BY a.academic_year_id DESC LIMIT 1) AS stop
           FROM students s
           LEFT JOIN LATERAL (SELECT g.user_id, g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.receives_notifications ORDER BY sg.is_primary DESC, g.id LIMIT 1) g ON true
          WHERE s.rfid_tag = $1 AND s.deleted_at IS NULL AND s.status = 'active'`,
        [ev.tag, lookup.route_id],
      );
      let outcome: string;
      let studentId: string | null = null;
      if (!st.rows[0]) outcome = 'unknown_tag';
      else {
        studentId = st.rows[0].id;
        const dup = await c.query(
          `SELECT 1 FROM bus_attendance WHERE student_id = $1 AND direction = $2::rfid_direction AND occurred_at BETWEEN $3::timestamptz - interval '60 seconds' AND $3::timestamptz + interval '60 seconds' AND outcome IN ('boarded', 'alighted')`,
          [studentId, direction, ev.at],
        );
        outcome = dup.rowCount ? 'duplicate' : direction === 'in' ? 'boarded' : 'alighted';
      }
      const ins = await c.query<{ id: string }>(
        `INSERT INTO bus_attendance (school_id, device_id, route_id, student_id, tag, on_date, direction, occurred_at, lat, lng, outcome, raw)
         VALUES (app.current_school_id(), $1, $2, $3, $4, ($5::timestamptz AT TIME ZONE 'Asia/Kolkata')::date, $6::rfid_direction, $5::timestamptz, $7, $8, $9, $10::jsonb) RETURNING id::text`,
        [
          lookup.device_id,
          lookup.route_id,
          studentId,
          ev.tag,
          ev.at,
          direction,
          ev.lat ?? null,
          ev.lng ?? null,
          outcome,
          JSON.stringify(ev),
        ],
      );
      if ((outcome === 'boarded' || outcome === 'alighted') && st.rows[0]?.guardian_mobile) {
        const s = st.rows[0];
        const withdrawn = s.guardian_user_id
          ? await c.query<{ s: string | null }>(
              `SELECT app.consent_status($1, 'transport.tracking')::text AS s`,
              [s.guardian_user_id],
            )
          : { rows: [{ s: null }] };
        if (withdrawn.rows[0]?.s !== 'withdrawn') {
          const sent = await this.alert(c, ctx, outcome, {
            userId: s.guardian_user_id,
            mobile: s.guardian_mobile!,
            variables: {
              student_name: s.name,
              time: new Date(ev.at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Kolkata',
              }),
              stop: s.stop ?? '',
              school: school.rows[0]?.name ?? '',
            },
          });
          if (sent)
            await c.query(`UPDATE bus_attendance SET alert_sent_at = now() WHERE id = $1`, [
              ins.rows[0]!.id,
            ]);
        }
      }
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    await c.query(`UPDATE rfid_devices SET last_seen_at = now() WHERE id = $1`, [lookup.device_id]);
    return { received: dto.events.length, outcomes };
  }

  private async alert(
    c: PoolClient,
    ctx: RequestContext,
    outcome: string,
    to: { userId: string | null; mobile: string; variables: Record<string, string> },
  ): Promise<boolean> {
    const templateCode = outcome === 'boarded' ? 'bus_boarded' : 'bus_alighted';
    const send = (userId: string | undefined) =>
      this.messages.sendWith(c, ctx, {
        templateCode,
        channel: 'whatsapp',
        recipientUserId: userId,
        recipientAddress: to.mobile,
        variables: to.variables,
      } as SendMessageDto);
    try {
      await send(to.userId ?? undefined);
      return true;
    } catch (error) {
      if (error instanceof DomainError && error.type === 'comms.template.not_found') {
        this.log.warn({ outcome }, 'bus alert template missing; no alert sent');
        return false;
      }
      if (error instanceof DomainError && error.type === 'user.not_member') {
        await send(undefined); // the guardian has no login at this school: address only
        return true;
      }
      throw error;
    }
  }

  // ---- reads --------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: BusQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const date =
        q.date ??
        (
          await c.query<{ d: string }>(
            `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
          )
        ).rows[0]!.d;
      const params: unknown[] = [date];
      let route = '';
      if (q.routeId) {
        params.push(q.routeId);
        route = `AND b.route_id = $2`;
      }
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- route is a fixed fragment; values are bound parameters
        `SELECT b.id::text, b.occurred_at, b.direction::text, b.outcome, b.tag, b.lat::text, b.lng::text, s.display_name AS student, s.id::text AS student_id, r.code AS route, d.code AS device, b.alert_sent_at
           FROM bus_attendance b LEFT JOIN students s ON s.id = b.student_id LEFT JOIN transport_routes r ON r.id = b.route_id JOIN rfid_devices d ON d.id = b.device_id
          WHERE b.on_date = $1::date ${route} ORDER BY b.occurred_at DESC LIMIT 500`,
        params,
      );
      const byRoute = await c.query<{ route: string; boarded: number; alighted: number }>(
        `SELECT COALESCE(r.code, '—') AS route, sum((b.outcome = 'boarded')::int)::int AS boarded, sum((b.outcome = 'alighted')::int)::int AS alighted
           FROM bus_attendance b LEFT JOIN transport_routes r ON r.id = b.route_id WHERE b.on_date = $1::date GROUP BY 1 ORDER BY 1`,
        [date],
      );
      return { date, routes: byRoute.rows, data: r.rows.map(toEvent) };
    });
  }

  async mine(ctx: RequestContext, q: BusQueryDto) {
    const v = await this.viewer.resolve(ctx, 'attendance.bus.view');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const date =
        q.date ??
        (
          await c.query<{ d: string }>(
            `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
          )
        ).rows[0]!.d;
      if (v.kind !== 'family') return { date, children: [] };
      const children = [];
      for (const s of v.students) {
        const r = await c.query<Record<string, unknown>>(
          `SELECT b.id::text, b.occurred_at, b.direction::text, b.outcome, b.tag, b.lat::text, b.lng::text, s.display_name AS student, s.id::text AS student_id, r.code AS route, d.code AS device, b.alert_sent_at
             FROM bus_attendance b JOIN students s ON s.id = b.student_id LEFT JOIN transport_routes r ON r.id = b.route_id JOIN rfid_devices d ON d.id = b.device_id
            WHERE b.student_id = $1 AND b.on_date >= $2::date - 7 AND b.outcome IN ('boarded', 'alighted') ORDER BY b.occurred_at DESC LIMIT 60`,
          [s.id, date],
        );
        children.push({ id: s.id, name: s.name, section: s.section, events: r.rows.map(toEvent) });
      }
      return { date, children };
    });
  }
}

const toEvent = (x: Record<string, unknown>) => ({
  id: x.id as string,
  occurredAt: (x.occurred_at as Date).toISOString(),
  direction: x.direction as string,
  outcome: x.outcome as string,
  tag: x.tag as string,
  lat: (x.lat as string) ?? null,
  lng: (x.lng as string) ?? null,
  student: (x.student as string) ?? null,
  studentId: (x.student_id as string) ?? null,
  route: (x.route as string) ?? null,
  device: x.device as string,
  alertSentAt: x.alert_sent_at ? (x.alert_sent_at as Date).toISOString() : null,
});
