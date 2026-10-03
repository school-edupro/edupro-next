import { Injectable } from '@nestjs/common';
import bwipjs from 'bwip-js';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { publicTenant, type Applicant } from '../admissions/public/otp.service';
import { visitorCardPdf } from './visitor-card';
import type {
  AdmitVisitorDto,
  ExitVisitorDto,
  ExportVisitorsDto,
  ListVisitorsDto,
  RegisterVisitorDto,
  SelfRegisterDto,
} from './visitors.dto';

type Row = Record<string, unknown>;
type State = 'waiting' | 'inside' | 'left' | 'cancelled';

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
const EXPORT_MAX = 5000;

const SELECT = `SELECT v.id::text, v.number, v.pass_code, v.source, v.state, v.visitor_name, v.mobile, v.email::text, v.organisation, v.visitor_type,
       v.party_size, v.id_proof_kind, v.id_proof_last4, v.vehicle_no, v.equipment, v.purpose, v.host_id::text, h.name AS host_name,
       COALESCE(e.display_name, he.display_name) AS with_name, v.to_meet, COALESCE(h.location, NULL) AS place,
       v.gate, v.exit_gate, v.exit_note, v.badge_no, v.in_at, v.out_at, v.created_at, v.appointment_id::text,
       COALESCE((SELECT le.display_name FROM employees le WHERE le.user_id = v.logged_by LIMIT 1), lu.display_name) AS logged_by,
       EXISTS (SELECT 1 FROM visitor_photos p WHERE p.visitor_log_id = v.id)
         OR EXISTS (SELECT 1 FROM appointment_photos ap WHERE ap.appointment_id = v.appointment_id) AS has_photo
  FROM visitor_log v
  LEFT JOIN appointment_hosts h ON h.id = v.host_id
  LEFT JOIN employees e ON e.id = v.with_employee_id
  LEFT JOIN employees he ON he.id = h.employee_id
  LEFT JOIN users lu ON lu.id = v.logged_by`;

export interface VisitorRow {
  id: string;
  number: string;
  passCode: string | null;
  source: 'gate' | 'self' | 'appointment';
  state: State;
  visitorName: string;
  mobile: string | null;
  email: string | null;
  organisation: string | null;
  visitorType: string | null;
  partySize: number;
  idProofKind: string | null;
  idProofLast4: string | null;
  vehicleNo: string | null;
  equipment: string | null;
  purpose: string;
  hostId: string | null;
  /** The person or desk to meet, as one line. */
  toMeet: string | null;
  place: string | null;
  gate: string | null;
  exitGate: string | null;
  exitNote: string | null;
  badgeNo: string | null;
  inAt: string | null;
  outAt: string | null;
  createdAt: string;
  appointmentId: string | null;
  loggedBy: string | null;
  hasPhoto: boolean;
}

const toRow = (x: Row): VisitorRow => ({
  id: String(x.id),
  number: String(x.number),
  passCode: text(x.pass_code),
  source: x.source as VisitorRow['source'],
  state: x.state as State,
  visitorName: String(x.visitor_name),
  mobile: text(x.mobile),
  email: text(x.email),
  organisation: text(x.organisation),
  visitorType: text(x.visitor_type),
  partySize: Number(x.party_size ?? 1),
  idProofKind: text(x.id_proof_kind),
  idProofLast4: text(x.id_proof_last4),
  vehicleNo: text(x.vehicle_no),
  equipment: text(x.equipment),
  purpose: String(x.purpose),
  hostId: text(x.host_id),
  toMeet:
    [text(x.host_name), text(x.with_name)].filter(Boolean).join(' · ') || text(x.to_meet) || null,
  place: text(x.place),
  gate: text(x.gate),
  exitGate: text(x.exit_gate),
  exitNote: text(x.exit_note),
  badgeNo: text(x.badge_no),
  inAt: iso(x.in_at),
  outAt: iso(x.out_at),
  createdAt: iso(x.created_at)!,
  appointmentId: text(x.appointment_id),
  loggedBy: text(x.logged_by),
  hasPhoto: Boolean(x.has_photo),
});

const ist = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
const STATE_LABEL: Record<State, string> = {
  waiting: 'Waiting at the gate',
  inside: 'Inside',
  left: 'Left',
  cancelled: 'Not let in',
};
const SOURCE_LABEL = { gate: 'Gate', self: 'Own phone', appointment: 'Appointment' };

interface Entry {
  source: 'gate' | 'self';
  state: 'inside' | 'waiting';
  mobile: string | null;
  applicantId: string | null;
  gate: string | null;
  badgeNo: string | null;
}

/**
 * The visitor gate pass (0065): walk-in visitors with no appointment. The guard registers a visitor at
 * the gate and lets them in, or the visitor registers on their own phone (mobile confirmed by a one-time
 * code) and waits for the guard. The person to be met is told by mail as the visitor comes in. A returning
 * visitor's details come back by mobile number. One register holds walk-ins and the appointment visitors
 * the gate checked in, with who is inside now, the exit, the printed card, Excel and PDF.
 */
@Injectable()
export class VisitorsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** What the gate picks from: visitor types, gates, ID proofs, purposes and the people and desks to meet. */
  private async optionsWith(c: PoolClient) {
    await c.query(`SELECT app.appointment_ensure_defaults()`);
    const s = await c.query<Row>(
      `SELECT visitor_types, gates, id_proof_kinds, purposes, visitor_self_enabled FROM appointment_settings WHERE school_id = app.current_school_id()`,
    );
    const hosts = await c.query<{ id: string; name: string; person: string | null }>(
      `SELECT h.id::text, h.name, e.display_name AS person FROM appointment_hosts h LEFT JOIN employees e ON e.id = h.employee_id
        WHERE h.status = 'active' AND h.kind <> 'class_teacher' ORDER BY h.sort_order, h.name`,
    );
    const x = s.rows[0]!;
    return {
      types: x.visitor_types as string[],
      gates: x.gates as string[],
      idProofKinds: x.id_proof_kinds as string[],
      purposes: x.purposes as string[],
      selfEnabled: Boolean(x.visitor_self_enabled),
      hosts: hosts.rows,
    };
  }

  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.optionsWith(c));
  }

  private photoOf(dataUrl: string | undefined): { contentType: string; bytes: Buffer } | null {
    if (!dataUrl) return null;
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    const bytes = m ? Buffer.from(m[2]!, 'base64') : null;
    if (!m || !bytes || bytes.length < 100 || bytes.length > 300_000)
      throw new DomainError(
        'validation-failed',
        'The photo must be a small JPEG, PNG or WebP image',
        {
          status: 400,
        },
      );
    return { contentType: m[1]!, bytes };
  }

  /** One path for the guard's entry and the visitor's own registration. */
  private async insert(
    c: PoolClient,
    dto: RegisterVisitorDto | SelfRegisterDto,
    e: Entry,
  ): Promise<{ id: string; number: string; state: string }> {
    const o = await this.optionsWith(c);
    if (dto.hostId && !o.hosts.some((h) => h.id === dto.hostId))
      throw new DomainError('validation-failed', 'Pick whom to meet from the list', {
        status: 400,
      });
    if (!dto.hostId && !dto.toMeet)
      throw new DomainError('validation-failed', 'Say whom the visitor has come to meet', {
        status: 400,
      });
    if (dto.visitorType && !o.types.includes(dto.visitorType))
      throw new DomainError('validation-failed', 'Pick the visitor type from the list', {
        status: 400,
      });
    const photo = this.photoOf(dto.photo);
    const r = await c.query<{ id: string; number: string }>(
      `INSERT INTO visitor_log (school_id, source, state, visitor_name, mobile, email, organisation, visitor_type, party_size, id_proof_kind, id_proof_last4,
              vehicle_no, equipment, purpose, host_id, to_meet, gate, badge_no, applicant_id, logged_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              COALESCE($15, (SELECT h.name FROM appointment_hosts h WHERE h.id = $14)), $16, $17, $18,
              CASE WHEN $1 = 'gate' THEN app.current_user_id() END)
       RETURNING id::text, number`,
      [
        e.source,
        e.state,
        dto.visitorName,
        e.mobile,
        dto.email ?? null,
        dto.organisation ?? null,
        dto.visitorType ?? null,
        dto.partySize,
        dto.idProofKind ?? null,
        dto.idProofLast4?.toUpperCase() ?? null,
        dto.vehicleNo?.toUpperCase() ?? null,
        dto.equipment ?? null,
        dto.purpose,
        dto.hostId ?? null,
        dto.toMeet ?? null,
        e.gate,
        e.badgeNo,
        e.applicantId,
      ],
    );
    const row = r.rows[0]!;
    if (photo)
      await c.query(
        `INSERT INTO visitor_photos (visitor_log_id, school_id, content_type, bytes) VALUES ($1, app.current_school_id(), $2, $3)`,
        [row.id, photo.contentType, photo.bytes],
      );
    // the person to be met hears as the visitor comes in (a waiting visitor: when the guard lets them in)
    if (e.state === 'inside') await c.query(`SELECT app.visitor_notify($1)`, [row.id]);
    return { ...row, state: e.state };
  }

  async register(ctx: RequestContext, dto: RegisterVisitorDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const out = await this.insert(c, dto, {
        source: 'gate',
        state: 'inside',
        mobile: dto.mobile ?? null,
        applicantId: null,
        gate: dto.gate ?? null,
        badgeNo: dto.badgeNo ?? null,
      });
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.in',
        entityType: 'visitor_log',
        entityId: out.id,
        after: { visitorName: dto.visitorName, purpose: dto.purpose, number: out.number },
      });
      return out;
    });
  }

  /** What this mobile gave on its last visit, so the guard does not type it again. */
  async lookup(ctx: RequestContext, mobile: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the mobile is bound
        `${SELECT} WHERE v.mobile = $1 ORDER BY v.created_at DESC LIMIT 1`,
        [mobile],
      );
      const visits = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM visitor_log WHERE mobile = $1 AND state <> 'cancelled'`,
        [mobile],
      );
      const v = r.rows[0] ? toRow(r.rows[0]) : null;
      return {
        visits: visits.rows[0]?.n ?? 0,
        last: v
          ? {
              visitorName: v.visitorName,
              organisation: v.organisation,
              visitorType: v.visitorType,
              email: v.email,
              idProofKind: v.idProofKind,
              idProofLast4: v.idProofLast4,
              vehicleNo: v.vehicleNo,
              hostId: v.hostId,
              lastVisit: v.inAt ?? v.createdAt,
              stillInside: v.state === 'inside',
            }
          : null,
      };
    });
  }

  private filterSql(q: ExportVisitorsDto, params: unknown[]): string {
    const where: string[] = [];
    if (q.state === 'inside') where.push(`v.state = 'inside'`);
    else if (q.state === 'waiting') where.push(`v.state = 'waiting'`);
    else if (q.state === 'left') where.push(`v.state = 'left'`);
    else if (q.state === 'today')
      where.push(`${DAY('COALESCE(v.in_at, v.created_at)')} = ${TODAY} AND v.state <> 'cancelled'`);
    else where.push('true');
    if (q.from) {
      params.push(q.from);
      where.push(`${DAY('COALESCE(v.in_at, v.created_at)')} >= $${String(params.length)}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`${DAY('COALESCE(v.in_at, v.created_at)')} <= $${String(params.length)}::date`);
    }
    if (q.hostId) {
      params.push(q.hostId);
      where.push(`v.host_id = $${String(params.length)}`);
    }
    if (q.type) {
      params.push(q.type);
      where.push(`v.visitor_type = $${String(params.length)}`);
    }
    if (q.q) {
      params.push(q.q);
      where.push(
        `concat_ws(' ', v.number, v.pass_code, v.visitor_name, v.mobile, v.organisation, v.vehicle_no, v.purpose, v.to_meet, v.badge_no) ILIKE '%' || $${String(params.length)} || '%'`,
      );
    }
    return where.join(' AND ');
  }

  /** The register, latest first, a page at a time, with the counts of the tabs. */
  async list(ctx: RequestContext, q: ListVisitorsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.filterSql(q, params);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments with numbered placeholders; values bound
        `SELECT count(*)::int AS n FROM visitor_log v WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; values bound
        `${SELECT} WHERE ${w} ORDER BY COALESCE(v.in_at, v.created_at) DESC, v.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const counts = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- DAY and TODAY are constants
        `SELECT count(*) FILTER (WHERE state = 'inside')::int AS inside,
                count(*) FILTER (WHERE state = 'waiting')::int AS waiting,
                count(*) FILTER (WHERE ${DAY('COALESCE(in_at, created_at)')} = ${TODAY} AND state <> 'cancelled')::int AS today,
                COALESCE(sum(party_size) FILTER (WHERE state = 'inside'), 0)::int AS people_inside
           FROM visitor_log`,
      );
      const n = counts.rows[0]!;
      return {
        data: r.rows.map(toRow),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: {
          inside: Number(n.inside),
          waiting: Number(n.waiting),
          today: Number(n.today),
          peopleInside: Number(n.people_inside),
        },
      };
    });
  }

  private async find(c: PoolClient, id: string): Promise<VisitorRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is bound
    const r = await c.query<Row>(`${SELECT} WHERE v.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Visitor not found');
    return toRow(r.rows[0]);
  }

  /** One entry with the barcode and QR of its pass (drawn as SVG) for the card on screen. */
  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.find(c, id);
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const code = v.passCode ?? v.number;
      return {
        ...v,
        school: school.rows[0]!.name,
        barcode: bwipjs.toSVG({
          bcid: 'code128',
          text: code,
          height: 10,
          includetext: false,
          paddingwidth: 2,
        }),
        qr: await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
      };
    });
  }

  private async photoWith(c: PoolClient, v: VisitorRow) {
    const r = await c.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type, bytes FROM visitor_photos WHERE visitor_log_id = $1
       UNION ALL SELECT content_type, bytes FROM appointment_photos WHERE appointment_id = $2 LIMIT 1`,
      [v.id, v.appointmentId],
    );
    return r.rows[0] ? { contentType: r.rows[0].content_type, bytes: r.rows[0].bytes } : null;
  }

  async photo(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const photo = await this.photoWith(c, await this.find(c, id));
      if (!photo) throw new DomainError('not-found', 'No photo for this visitor');
      return photo;
    });
  }

  /** The visitor card (ID-card size) with photo, details, QR and barcode of the pass. */
  async cardPdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.find(c, id);
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const code = v.passCode ?? v.number;
      const bytes = await visitorCardPdf({
        school: school.rows[0]!.name,
        kind: v.visitorType ?? 'Visitor',
        name: v.visitorName,
        rows: [
          ['From', v.organisation],
          ['Mobile', v.mobile],
          ['People', v.partySize > 1 ? String(v.partySize) : null],
          [
            'ID proof',
            v.idProofKind
              ? `${v.idProofKind}${v.idProofLast4 ? ` ...${v.idProofLast4}` : ''}`
              : null,
          ],
          ['To meet', v.toMeet],
          ['Purpose', v.purpose],
          ['Carrying', v.equipment],
          ['Vehicle', v.vehicleNo],
          ['In', ist(v.inAt) || null],
        ],
        number: v.number,
        code,
        qrText: code,
        photo: await this.photoWith(c, v),
      });
      return { bytes, filename: `visitor-card-${v.number}.pdf` };
    });
  }

  private async locked(c: PoolClient, id: string): Promise<State> {
    const r = await c.query<{ state: State }>(
      `SELECT state FROM visitor_log WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Visitor not found');
    return r.rows[0].state;
  }

  /** The guard lets in a visitor who registered on their own phone (after checking the ID). */
  async admit(ctx: RequestContext, id: string, dto: AdmitVisitorDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await this.locked(c, id)) !== 'waiting')
        throw new DomainError('visitor.wrong_state', 'This visitor is not waiting at the gate', {
          status: 409,
        });
      await c.query(
        `UPDATE visitor_log SET state = 'inside', in_at = now(), gate = COALESCE($2, gate), badge_no = COALESCE($3, badge_no), logged_by = app.current_user_id() WHERE id = $1`,
        [id, dto.gate ?? null, dto.badgeNo ?? null],
      );
      await c.query(`SELECT app.visitor_notify($1)`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.in',
        entityType: 'visitor_log',
        entityId: id,
        after: { admitted: true },
      });
      return { ok: true };
    });
  }

  /** The guard turns away a visitor who registered on their own phone. */
  async refuse(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await this.locked(c, id)) !== 'waiting')
        throw new DomainError('visitor.wrong_state', 'This visitor is not waiting at the gate', {
          status: 409,
        });
      await c.query(`UPDATE visitor_log SET state = 'cancelled' WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.refused',
        entityType: 'visitor_log',
        entityId: id,
      });
      return { ok: true };
    });
  }

  /** The visitor leaves: out time, the gate and a note (equipment taken back, anything left behind). */
  async exit(ctx: RequestContext, id: string, dto: ExitVisitorDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if ((await this.locked(c, id)) !== 'inside')
        throw new DomainError('visitor.wrong_state', 'This visitor is not inside', { status: 409 });
      await c.query(
        `UPDATE visitor_log SET state = 'left', out_at = now(), exit_gate = $2, exit_note = $3, out_by = app.current_user_id() WHERE id = $1`,
        [id, dto.exitGate ?? null, dto.note ?? null],
      );
      // an appointment visitor leaving through the register closes the appointment too
      await c.query(
        `UPDATE appointments SET state = 'completed', checked_out_at = now(), updated_at = now() WHERE visitor_log_id = $1 AND state = 'checked_in'`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.visitor.out',
        entityType: 'visitor_log',
        entityId: id,
        after: { exitGate: dto.exitGate ?? null, note: dto.note ?? null },
      });
      return { ok: true };
    });
  }

  /** The register as it is filtered on screen, as Excel. */
  async report(
    ctx: RequestContext,
    q: ExportVisitorsDto,
  ): Promise<{ bytes: Buffer; filename: string }> {
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.filterSql(q, params);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; the limit is a number
        `${SELECT} WHERE ${w} ORDER BY COALESCE(v.in_at, v.created_at) DESC, v.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toRow);
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Visitors');
    ws.addRow([`Visitor register · ${String(rows.length)} rows`]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.addRow([
      'Pass no.',
      'Visitor',
      'Type',
      'Mobile',
      'Coming from',
      'People',
      'ID proof',
      'To meet',
      'Purpose',
      'Carrying',
      'Vehicle',
      'In',
      'Gate',
      'Out',
      'Exit gate',
      'Minutes inside',
      'Status',
      'Registered by',
      'Exit note',
    ]).font = { bold: true };
    for (const v of rows)
      ws.addRow([
        v.number,
        v.visitorName,
        v.visitorType ?? '',
        v.mobile ?? '',
        v.organisation ?? '',
        v.partySize,
        v.idProofKind ? `${v.idProofKind}${v.idProofLast4 ? ` …${v.idProofLast4}` : ''}` : '',
        v.toMeet ?? '',
        v.purpose,
        v.equipment ?? '',
        v.vehicleNo ?? '',
        ist(v.inAt),
        v.gate ?? '',
        ist(v.outAt),
        v.exitGate ?? '',
        v.inAt && v.outAt
          ? Math.round((new Date(v.outAt).getTime() - new Date(v.inAt).getTime()) / 60_000)
          : '',
        STATE_LABEL[v.state],
        v.loggedBy ?? SOURCE_LABEL[v.source],
        v.exitNote ?? '',
      ]);
    [14, 24, 18, 13, 22, 7, 18, 24, 30, 24, 13, 18, 12, 18, 12, 9, 16, 20, 30].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `visitors-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  // ---- the visitor's own phone (the gate QR) --------------------------------------------------------
  private async publicSchool(code: string): Promise<TenantContext> {
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string | null }>(
        `SELECT app.public_school_id($1)::text AS id`,
        [code],
      );
      return r.rows[0]?.id ?? null;
    });
    if (!id) throw new DomainError('not-found', 'School not found');
    return publicTenant(id);
  }

  private async ownSchool(schoolCode: string, applicant: Applicant): Promise<TenantContext> {
    const tenant = await this.publicSchool(schoolCode);
    if (tenant.schoolId !== applicant.schoolId)
      throw new DomainError(
        'applicant-unauthenticated',
        'Confirm your mobile number for this school first',
        {
          status: 401,
        },
      );
    return tenant;
  }

  /** What the self-registration page shows before sign-in. */
  async publicOptions(schoolCode: string) {
    const tenant = await this.publicSchool(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const o = await this.optionsWith(c);
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return {
        school: school.rows[0]!.name,
        enabled: o.selfEnabled,
        types: o.types,
        idProofKinds: o.idProofKinds,
        purposes: o.purposes,
        // an outsider sees the desk, never who sits there
        hosts: o.hosts.map((h) => ({ id: h.id, name: h.name })),
      };
    });
  }

  /** The visitor's entry of today (waiting or inside) and what they gave last time. */
  async publicMine(schoolCode: string, applicant: Applicant) {
    const tenant = await this.ownSchool(schoolCode, applicant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT, DAY and TODAY are constants; values bound
        `${SELECT} WHERE (v.applicant_id = $1 OR v.mobile = $2) ORDER BY v.created_at DESC LIMIT 5`,
        [applicant.id, applicant.mobile],
      );
      const rows = r.rows.map(toRow);
      const live = rows.find((v) => ['waiting', 'inside'].includes(v.state)) ?? null;
      const last = rows[0] ?? null;
      return {
        current: live
          ? {
              id: live.id,
              number: live.number,
              passCode: live.passCode,
              state: live.state,
              visitorName: live.visitorName,
              toMeet: live.toMeet,
              purpose: live.purpose,
              createdAt: live.createdAt,
              // what the guard scans to find this entry
              barcode: bwipjs.toSVG({
                bcid: 'code128',
                text: live.passCode ?? live.number,
                height: 10,
                includetext: false,
                paddingwidth: 2,
              }),
            }
          : null,
        profile: last
          ? {
              visitorName: last.visitorName,
              organisation: last.organisation,
              visitorType: last.visitorType,
              email: last.email,
              idProofKind: last.idProofKind,
              idProofLast4: last.idProofLast4,
              vehicleNo: last.vehicleNo,
            }
          : null,
      };
    });
  }

  async publicRegister(schoolCode: string, applicant: Applicant, dto: SelfRegisterDto) {
    const tenant = await this.ownSchool(schoolCode, applicant);
    return this.db.tenant(tenant, async (c) => {
      const o = await this.optionsWith(c);
      if (!o.selfEnabled)
        throw new DomainError('visitor.self_closed', 'Please register with the guard at the gate', {
          status: 409,
        });
      const open = await c.query(
        `SELECT 1 FROM visitor_log WHERE (applicant_id = $1 OR mobile = $2) AND state IN ('waiting', 'inside')`,
        [applicant.id, applicant.mobile],
      );
      if (open.rowCount)
        throw new DomainError('visitor.already_in', 'You already have a visitor pass for today', {
          status: 409,
        });
      if (!dto.photo)
        throw new DomainError('validation-failed', 'Your photo is required', { status: 400 });
      await c.query(
        `UPDATE applicants SET name = $2, email = COALESCE($3::citext, email) WHERE id = $1`,
        [applicant.id, dto.visitorName, dto.email ?? null],
      );
      return this.insert(c, dto, {
        source: 'self',
        state: 'waiting',
        mobile: applicant.mobile,
        applicantId: applicant.id,
        gate: null,
        badgeNo: null,
      });
    });
  }
}
