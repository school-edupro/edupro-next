import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { publicTenant, type Applicant } from '../admissions/public/otp.service';
import type {
  AppointmentSettingsDto,
  AppointmentState,
  ApproveDto,
  CalendarQueryDto,
  CancelDto,
  CheckInDto,
  DeskBookDto,
  ExportAppointmentsDto,
  FamilyBookDto,
  HostDto,
  ListAppointmentsDto,
  PublicBookDto,
  RejectDto,
  RescheduleDto,
  SlotsQueryDto,
} from './appointments.dto';

type Row = Record<string, unknown>;
type Source = 'parent' | 'public' | 'front_desk';

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** A slot start (school time) as a timestamp. */
const TS = (n: number) => `($${String(n)} || ':00+05:30')::timestamptz`;
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
/** The states in which a booking holds its slot. */
const HOLDING = `('requested', 'approved', 'checked_in')`;
const EXPORT_MAX = 5000;
const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const SELECT = `SELECT a.id::text, a.number, a.source, a.state, a.purpose, a.host_id::text, h.name AS host_name, h.kind AS host_kind,
       COALESCE(e.display_name, he.display_name) AS with_name, COALESCE(a.location, h.location) AS place,
       a.starts_at, a.ends_at, a.preferred_slots, a.student_id::text, s.display_name AS student, s.admission_no,
       (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
         WHERE en.student_id = s.id AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1) AS section,
       a.visitor_name, a.visitor_mobile, a.visitor_email::text, a.visitor_org, a.party_size, a.id_proof_kind, a.id_proof_last4,
       a.pass_code, a.decision_note, a.cancel_reason, a.reschedule_count, a.previous_starts_at, a.checked_in_at, a.checked_out_at,
       a.created_at, a.decided_at, COALESCE((SELECT de.display_name FROM employees de WHERE de.user_id = a.decided_by LIMIT 1), du.display_name) AS decided_by,
       EXISTS (SELECT 1 FROM appointment_photos p WHERE p.appointment_id = a.id) AS has_photo
  FROM appointments a
  LEFT JOIN appointment_hosts h ON h.id = a.host_id
  LEFT JOIN employees e ON e.id = a.with_employee_id
  LEFT JOIN employees he ON he.id = h.employee_id
  LEFT JOIN students s ON s.id = a.student_id
  LEFT JOIN users du ON du.id = a.decided_by`;

export interface AppointmentRow {
  id: string;
  number: string;
  source: Source;
  state: AppointmentState;
  purpose: string;
  hostId: string | null;
  hostName: string | null;
  hostKind: string | null;
  withName: string | null;
  place: string | null;
  startsAt: string | null;
  endsAt: string | null;
  preferredSlots: string[];
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  visitorName: string | null;
  visitorMobile: string | null;
  visitorEmail: string | null;
  visitorOrg: string | null;
  partySize: number;
  idProofKind: string | null;
  idProofLast4: string | null;
  passCode: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  rescheduleCount: number;
  previousStartsAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  hasPhoto: boolean;
}

const toRow = (x: Row): AppointmentRow => ({
  id: String(x.id),
  number: String(x.number),
  source: x.source as Source,
  state: x.state as AppointmentState,
  purpose: String(x.purpose),
  hostId: text(x.host_id),
  hostName: text(x.host_name),
  hostKind: text(x.host_kind),
  withName: text(x.with_name),
  place: text(x.place),
  startsAt: iso(x.starts_at),
  endsAt: iso(x.ends_at),
  preferredSlots: (x.preferred_slots as string[] | null) ?? [],
  studentId: text(x.student_id),
  student: text(x.student),
  admissionNo: text(x.admission_no),
  section: text(x.section),
  visitorName: text(x.visitor_name),
  visitorMobile: text(x.visitor_mobile),
  visitorEmail: text(x.visitor_email),
  visitorOrg: text(x.visitor_org),
  partySize: Number(x.party_size ?? 1),
  idProofKind: text(x.id_proof_kind),
  idProofLast4: text(x.id_proof_last4),
  passCode: text(x.pass_code),
  decisionNote: text(x.decision_note),
  cancelReason: text(x.cancel_reason),
  rescheduleCount: Number(x.reschedule_count ?? 0),
  previousStartsAt: iso(x.previous_starts_at),
  checkedInAt: iso(x.checked_in_at),
  checkedOutAt: iso(x.checked_out_at),
  createdAt: iso(x.created_at)!,
  decidedAt: iso(x.decided_at),
  decidedBy: text(x.decided_by),
  hasPhoto: Boolean(x.has_photo),
});

export interface AppointmentSettings {
  publicEnabled: boolean;
  autoApprove: boolean;
  minNoticeHours: number;
  maxDaysAhead: number;
  maxParty: number;
  askOrganisation: 'off' | 'optional' | 'required';
  askIdProof: 'off' | 'optional' | 'required';
  askPhoto: 'off' | 'optional' | 'required';
  idProofKinds: string[];
  purposes: string[];
  notifySms: boolean;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  reminderHours: number;
  noShowMinutes: number;
  closedDates: string[];
  instructions: string | null;
}

interface Host {
  id: string;
  name: string;
  kind: 'desk' | 'person' | 'class_teacher';
  employeeId: string | null;
  employeeName: string | null;
  location: string | null;
  openPublic: boolean;
  openParent: boolean;
  slotMinutes: number;
  capacity: number;
  sortOrder: number;
  status: string;
}

export interface Slot {
  time: string;
  startsAt: string;
  free: number;
  available: boolean;
}

interface Booking {
  source: Source;
  hostId: string;
  startsAt: string;
  purpose: string;
  studentId: string | null;
  visitorName: string | null;
  visitorMobile: string | null;
  visitorEmail: string | null;
  visitorOrg: string | null;
  partySize: number;
  idProofKind: string | null;
  idProofLast4: string | null;
  photo: string | null;
  requestedBy: string | null;
  applicantId: string | null;
  /** The front desk confirms as it books. */
  approve: boolean;
  byDesk: boolean;
}

const HOST_SELECT = `SELECT h.id::text, h.name, h.kind, h.employee_id::text, e.display_name AS employee_name, h.location, h.open_public, h.open_parent,
       h.slot_minutes, h.capacity, h.sort_order, h.status::text
  FROM appointment_hosts h LEFT JOIN employees e ON e.id = h.employee_id`;
const toHost = (x: Row): Host => ({
  id: String(x.id),
  name: String(x.name),
  kind: x.kind as Host['kind'],
  employeeId: text(x.employee_id),
  employeeName: text(x.employee_name),
  location: text(x.location),
  openPublic: Boolean(x.open_public),
  openParent: Boolean(x.open_parent),
  slotMinutes: Number(x.slot_minutes),
  capacity: Number(x.capacity),
  sortOrder: Number(x.sort_order),
  status: String(x.status),
});

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** India time for a sheet or a message: 05 Oct 2026, 09:30. */
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

const STATE_LABEL: Record<AppointmentState, string> = {
  requested: 'Waiting',
  approved: 'Confirmed',
  rejected: 'Not confirmed',
  cancelled: 'Cancelled',
  checked_in: 'Arrived',
  completed: 'Completed',
  no_show: 'Did not come',
};

/**
 * Appointments v2 (0059). People and desks that can be met have visiting days and hours cut into fixed
 * slots. A parent (in the app), an outside visitor (from the school's QR code, after a mobile OTP) or the
 * front desk (walk-ins, calls) books a free slot; the front desk approves, rejects or reschedules and the
 * requester is told by SMS / WhatsApp / email. A confirmed appointment carries a pass code that becomes
 * the visitor-log entry at the gate. Also here: the calendar, the dashboard, the Excel and the set-up.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---- set-up read by every flow --------------------------------------------------------------------
  private async settings(c: PoolClient): Promise<AppointmentSettings> {
    await c.query(`SELECT app.appointment_ensure_defaults()`);
    const r = await c.query<Row>(
      `SELECT public_enabled, auto_approve, min_notice_hours, max_days_ahead, max_party, ask_organisation, ask_id_proof, ask_photo,
              id_proof_kinds, purposes, notify_sms, notify_whatsapp, notify_email, reminder_hours, no_show_minutes,
              ARRAY(SELECT to_char(d, 'YYYY-MM-DD') FROM unnest(closed_dates) AS d ORDER BY d) AS closed_dates, instructions
         FROM appointment_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      publicEnabled: Boolean(x.public_enabled),
      autoApprove: Boolean(x.auto_approve),
      minNoticeHours: Number(x.min_notice_hours),
      maxDaysAhead: Number(x.max_days_ahead),
      maxParty: Number(x.max_party),
      askOrganisation: x.ask_organisation as AppointmentSettings['askOrganisation'],
      askIdProof: x.ask_id_proof as AppointmentSettings['askIdProof'],
      askPhoto: x.ask_photo as AppointmentSettings['askPhoto'],
      idProofKinds: x.id_proof_kinds as string[],
      purposes: x.purposes as string[],
      notifySms: Boolean(x.notify_sms),
      notifyWhatsapp: Boolean(x.notify_whatsapp),
      notifyEmail: Boolean(x.notify_email),
      reminderHours: Number(x.reminder_hours),
      noShowMinutes: Number(x.no_show_minutes),
      closedDates: x.closed_dates as string[],
      instructions: text(x.instructions),
    };
  }

  private async host(c: PoolClient, id: string): Promise<Host> {
    // eslint-disable-next-line no-restricted-syntax -- HOST_SELECT is a constant; the id is bound
    const r = await c.query<Row>(`${HOST_SELECT} WHERE h.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'That person or desk was not found');
    return toHost(r.rows[0]);
  }

  /** The people and desks one audience may book, with their visiting hours. */
  private async hostsFor(c: PoolClient, audience: 'public' | 'parent' | 'desk') {
    const cond =
      audience === 'public'
        ? 'AND h.open_public'
        : audience === 'parent'
          ? 'AND h.open_parent'
          : '';
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- HOST_SELECT and cond are constants
      `${HOST_SELECT} WHERE h.status = 'active' ${cond} ORDER BY h.sort_order, h.name`,
    );
    const hours = await c.query<{ host_id: string; weekday: number; starts: string; ends: string }>(
      `SELECT host_id::text, weekday, to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends
         FROM appointment_host_hours ORDER BY host_id, weekday, starts`,
    );
    return r.rows.map(toHost).map((h) => ({
      id: h.id,
      name: h.name,
      kind: h.kind,
      // an outsider sees the desk, never who sits there
      person: audience === 'public' ? null : h.employeeName,
      location: h.location,
      slotMinutes: h.slotMinutes,
      hours: hours.rows
        .filter((x) => x.host_id === h.id)
        .map((x) => ({ weekday: x.weekday, starts: x.starts, ends: x.ends })),
    }));
  }

  private async classTeacher(c: PoolClient, studentId: string): Promise<string | null> {
    const r = await c.query<{ id: string }>(
      `SELECT ta.employee_id::text AS id FROM enrolments en
         JOIN teacher_assignments ta ON ta.class_section_id = en.class_section_id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
         JOIN employees e ON e.id = ta.employee_id AND e.deleted_at IS NULL
        WHERE en.student_id = $1 AND en.status = 'active' ORDER BY en.academic_year_id DESC, ta.id LIMIT 1`,
      [studentId],
    );
    return r.rows[0]?.id ?? null;
  }

  // ---- slots ----------------------------------------------------------------------------------------
  /**
   * The slots of one person or desk on a day. A day is closed when it is a holiday, a closed date, in
   * the past or further ahead than the school allows; a slot is free while fewer bookings than its
   * capacity hold it and (for the public and parents) it is not sooner than the notice the school asks.
   */
  private async slots(
    c: PoolClient,
    s: AppointmentSettings,
    host: Host,
    date: string,
    withEmployee: string | null,
    opts: { byDesk: boolean; excludeId?: string },
  ): Promise<{ closed: string | null; slots: Slot[] }> {
    const day = await c.query<{ dow: number; past: boolean; far: boolean; holiday: string | null }>(
      // eslint-disable-next-line no-restricted-syntax -- TODAY is a constant; values bound
      `SELECT extract(isodow FROM $1::date)::int AS dow, ($1::date < ${TODAY}) AS past, ($1::date > ${TODAY} + $2::int) AS far,
              (SELECT hd.name FROM holidays hd WHERE hd.kind <> 'working_day' AND hd.applies_to <> 'students'
                  AND $1::date BETWEEN hd.starts_on AND hd.ends_on LIMIT 1) AS holiday`,
      [date, s.maxDaysAhead],
    );
    const d = day.rows[0]!;
    if (d.past) return { closed: 'That day has passed.', slots: [] };
    if (d.far && !opts.byDesk)
      return {
        closed: `Appointments open ${String(s.maxDaysAhead)} days ahead.`,
        slots: [],
      };
    if (d.holiday) return { closed: `The school is closed: ${d.holiday}.`, slots: [] };
    if (s.closedDates.includes(date))
      return { closed: 'No appointments are taken on this day.', slots: [] };
    const hours = await c.query<{ starts: string; ends: string }>(
      `SELECT to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends FROM appointment_host_hours
        WHERE host_id = $1 AND weekday = $2 ORDER BY starts`,
      [host.id, d.dow],
    );
    if (!hours.rows.length) return { closed: 'No visiting hours on this day.', slots: [] };
    const taken = await c.query<{ t: string; n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- HOLDING and DAY are constants; values bound
      `SELECT to_char(starts_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS t, count(*)::int AS n FROM appointments
        WHERE host_id = $1 AND state IN ${HOLDING} AND ${DAY('starts_at')} = $2::date
          AND ($3::bigint IS NULL OR with_employee_id = $3) AND ($4::bigint IS NULL OR id <> $4)
        GROUP BY 1`,
      [host.id, date, withEmployee, opts.excludeId ?? null],
    );
    const used = new Map(taken.rows.map((x) => [x.t, x.n]));
    const now = Date.now();
    const slots: Slot[] = [];
    for (const w of hours.rows) {
      for (
        let m = minutes(w.starts);
        m + host.slotMinutes <= minutes(w.ends);
        m += host.slotMinutes
      ) {
        const time = hhmm(m);
        const startsAt = `${date}T${time}`;
        const at = Date.parse(`${startsAt}:00+05:30`);
        const free = Math.max(0, host.capacity - (used.get(time) ?? 0));
        // the desk may still use the slot that is running; others need the notice the school asks
        const inTime = opts.byDesk
          ? at + host.slotMinutes * 60_000 > now
          : at >= now + s.minNoticeHours * 3_600_000;
        slots.push({ time, startsAt, free, available: free > 0 && inTime });
      }
    }
    return { closed: null, slots };
  }

  private passCode(): string {
    return [...randomBytes(10)].map((b) => PASS_ALPHABET[b % PASS_ALPHABET.length]).join('');
  }

  private async passLink(c: PoolClient, code: string | null): Promise<string | null> {
    if (!code) return null;
    const r = await c.query<{ code: string }>(
      `SELECT lower(code) AS code FROM schools WHERE id = app.current_school_id()`,
    );
    return `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/${r.rows[0]!.code}/pass/${code}`;
  }

  private async event(
    c: PoolClient,
    id: string,
    kind: string,
    detail: Record<string, unknown> = {},
  ) {
    await c.query(
      `INSERT INTO appointment_events (school_id, appointment_id, actor_user_id, kind, detail)
       VALUES (app.current_school_id(), $1, app.current_user_id(), $2, $3::jsonb)`,
      [id, kind, JSON.stringify(detail)],
    );
  }

  private async notify(c: PoolClient, id: string, event: string, reason?: string | null) {
    const code = await c.query<{ pass_code: string | null }>(
      `SELECT pass_code FROM appointments WHERE id = $1`,
      [id],
    );
    const link = ['approved', 'rescheduled'].includes(event)
      ? await this.passLink(c, code.rows[0]?.pass_code ?? null)
      : null;
    await c.query(`SELECT app.appointment_notify($1, $2, $3, $4)`, [
      id,
      event,
      reason ?? null,
      link,
    ]);
  }

  // ---- booking (one path for the parent app, the public page and the front desk) --------------------
  private async place(
    c: PoolClient,
    s: AppointmentSettings,
    b: Booking,
  ): Promise<{ id: string; state: string }> {
    const host = await this.host(c, b.hostId);
    if (host.status !== 'active')
      throw new DomainError('appointment.host_closed', `${host.name} is not taking appointments`, {
        status: 409,
      });
    if (b.source === 'public' && !host.openPublic)
      throw new DomainError('not-found', 'That person or desk was not found');
    if (b.source === 'parent' && !host.openParent)
      throw new DomainError('not-found', 'That person or desk was not found');
    if (b.partySize > s.maxParty)
      throw new DomainError('validation-failed', `At most ${String(s.maxParty)} people may come`, {
        status: 400,
      });
    let withEmployee: string | null = null;
    if (host.kind === 'class_teacher') {
      if (!b.studentId)
        throw new DomainError(
          'validation-failed',
          'Pick the child whose class teacher you want to meet',
          {
            status: 400,
          },
        );
      withEmployee = await this.classTeacher(c, b.studentId);
      if (!withEmployee)
        throw new DomainError(
          'appointment.no_class_teacher',
          'No class teacher is set for this class yet',
          {
            status: 409,
          },
        );
    }
    // two people asking for the last place in a slot wait for each other here
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `appointment:${host.id}:${withEmployee ?? ''}:${b.startsAt}`,
    ]);
    const { closed, slots } = await this.slots(c, s, host, b.startsAt.slice(0, 10), withEmployee, {
      byDesk: b.byDesk,
    });
    const slot = slots.find((x) => x.startsAt === b.startsAt);
    if (closed || !slot)
      throw new DomainError(
        'appointment.no_slot',
        closed ?? 'There is no such slot; pick one from the list',
        {
          status: 409,
        },
      );
    if (!slot.available)
      throw new DomainError(
        'appointment.slot_taken',
        slot.free > 0
          ? 'That slot is too soon; pick a later one'
          : 'That slot was just taken; pick another one',
        { status: 409 },
      );
    if (!b.byDesk) {
      const open = await c.query<{ n: number; same: number }>(
        // eslint-disable-next-line no-restricted-syntax -- TS is a constant fragment; values bound
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE host_id = $3 AND starts_at = ${TS(4)})::int AS same FROM appointments
          WHERE state IN ('requested', 'approved') AND starts_at > now()
            AND (($1::bigint IS NOT NULL AND applicant_id = $1) OR ($2::bigint IS NOT NULL AND requested_by = $2))`,
        [b.applicantId, b.requestedBy, host.id, b.startsAt],
      );
      if ((open.rows[0]?.same ?? 0) > 0)
        throw new DomainError('appointment.duplicate', 'You already have this slot', {
          status: 409,
        });
      if ((open.rows[0]?.n ?? 0) >= 3)
        throw new DomainError(
          'appointment.too_many',
          'You already have three appointments to come; cancel one to book another',
          { status: 409 },
        );
    }
    const photo = this.photoOf(b.photo);
    const approved = b.approve || s.autoApprove;
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- TS is a constant fragment; values bound
      `INSERT INTO appointments (school_id, number, source, state, status, host_id, with_kind, with_employee_id, student_id, requested_by, purpose,
              starts_at, ends_at, confirmed_at, visitor_name, visitor_mobile, visitor_email, visitor_org, party_size, id_proof_kind, id_proof_last4,
              applicant_id, pass_code, decided_by, decided_at, booked_by, request_id)
       VALUES (app.current_school_id(), app.next_appointment_no(), $1, $2, $3::workflow_status, $4, $5, $6, $7, $8, $9,
              ${TS(10)}, ${TS(10)} + make_interval(mins => $11::int), CASE WHEN $2 = 'approved' THEN ${TS(10)} END,
              $12, $13, $14, $15, $16, $17, $18, $19, $20,
              CASE WHEN $21::boolean THEN app.current_user_id() END, CASE WHEN $2 = 'approved' THEN now() END,
              CASE WHEN $21::boolean THEN app.current_user_id() END, app.current_request_id())
       RETURNING id::text`,
      [
        b.source,
        approved ? 'approved' : 'requested',
        approved ? 'approved' : 'pending',
        host.id,
        host.kind === 'class_teacher' ? 'class_teacher' : null,
        withEmployee,
        b.studentId,
        b.requestedBy,
        b.purpose,
        b.startsAt,
        host.slotMinutes,
        b.visitorName,
        b.visitorMobile,
        b.visitorEmail,
        b.visitorOrg,
        b.partySize,
        b.idProofKind,
        b.idProofLast4?.toUpperCase() ?? null,
        b.applicantId,
        this.passCode(),
        b.byDesk,
      ],
    );
    const id = r.rows[0]!.id;
    if (photo)
      await c.query(
        `INSERT INTO appointment_photos (appointment_id, school_id, content_type, bytes) VALUES ($1, app.current_school_id(), $2, $3)`,
        [id, photo.contentType, photo.bytes],
      );
    await this.event(c, id, 'requested', {
      source: b.source,
      startsAt: b.startsAt,
      host: host.name,
    });
    if (approved) await this.event(c, id, 'approved', { auto: !b.byDesk });
    await this.notify(c, id, approved ? 'approved' : 'requested');
    return { id, state: approved ? 'approved' : 'requested' };
  }

  private photoOf(dataUrl: string | null): { contentType: string; bytes: Buffer } | null {
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

  // ---- front desk -----------------------------------------------------------------------------------
  async deskHosts(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      return {
        data: await this.hostsFor(c, 'desk'),
        purposes: s.purposes,
        idProofKinds: s.idProofKinds,
        maxParty: s.maxParty,
      };
    });
  }

  async deskSlots(ctx: RequestContext, q: SlotsQueryDto, excludeId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const host = await this.host(c, q.hostId);
      const withEmployee =
        host.kind === 'class_teacher' && q.studentId
          ? await this.classTeacher(c, q.studentId)
          : null;
      return this.slots(c, s, host, q.date, withEmployee, { byDesk: true, excludeId });
    });
  }

  async deskBook(ctx: RequestContext, dto: DeskBookDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      let name = dto.visitorName ?? null;
      let mobile = dto.visitorMobile ?? null;
      let email = dto.visitorEmail ?? null;
      if (dto.studentId) {
        // about a pupil: the first guardian who receives notices is the person told, unless one is typed
        const g = await c.query<{ name: string; mobile: string | null; email: string | null }>(
          `SELECT g.display_name AS name, g.mobile, g.email::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
            WHERE sg.student_id = $1 ORDER BY sg.receives_notifications DESC, sg.is_primary DESC NULLS LAST, g.id LIMIT 1`,
          [dto.studentId],
        );
        const st = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
          dto.studentId,
        ]);
        if (!st.rowCount) throw new DomainError('not-found', 'Student not found');
        name ??= g.rows[0]?.name ?? null;
        mobile ??= g.rows[0]?.mobile ?? null;
        email ??= g.rows[0]?.email ?? null;
      }
      const out = await this.place(c, s, {
        source: 'front_desk',
        hostId: dto.hostId,
        startsAt: dto.startsAt,
        purpose: dto.purpose,
        studentId: dto.studentId ?? null,
        visitorName: name,
        visitorMobile: mobile,
        visitorEmail: email,
        visitorOrg: dto.visitorOrg ?? null,
        partySize: dto.partySize,
        idProofKind: dto.idProofKind ?? null,
        idProofLast4: dto.idProofLast4 ?? null,
        photo: dto.photo ?? null,
        requestedBy: null,
        applicantId: null,
        approve: dto.approve,
        byDesk: true,
      });
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.book',
        entityType: 'appointments',
        entityId: out.id,
        after: { hostId: dto.hostId, startsAt: dto.startsAt, state: out.state },
      });
      return out;
    });
  }

  private filterSql(q: ExportAppointmentsDto, params: unknown[]): string {
    const where: string[] = ['true'];
    if (q.state === 'open') where.push(`a.state = 'requested'`);
    else if (q.state === 'upcoming') where.push(`a.state = 'approved' AND a.starts_at >= now()`);
    else if (q.state === 'today')
      where.push(`${DAY('a.starts_at')} = ${TODAY} AND a.state NOT IN ('rejected', 'cancelled')`);
    else if (q.state) {
      params.push(q.state);
      where.push(`a.state = $${String(params.length)}`);
    }
    if (q.hostId) {
      params.push(q.hostId);
      where.push(`a.host_id = $${String(params.length)}`);
    }
    if (q.source) {
      params.push(q.source);
      where.push(`a.source = $${String(params.length)}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(
        `${DAY('COALESCE(a.starts_at, a.created_at)')} >= $${String(params.length)}::date`,
      );
    }
    if (q.to) {
      params.push(q.to);
      where.push(
        `${DAY('COALESCE(a.starts_at, a.created_at)')} <= $${String(params.length)}::date`,
      );
    }
    if (q.q) {
      params.push(q.q);
      where.push(
        `concat_ws(' ', a.number, a.visitor_name, a.visitor_mobile, a.visitor_org, s.display_name, s.admission_no, a.purpose) ILIKE '%' || $${String(params.length)} || '%'`,
      );
    }
    if (q.mine)
      where.push(
        `COALESCE(a.with_employee_id, h.employee_id) = (SELECT me.id FROM employees me WHERE me.user_id = app.current_user_id() AND me.deleted_at IS NULL LIMIT 1)`,
      );
    return where.join(' AND ');
  }

  /** The front-desk queue: latest first (or by visit time), a page at a time, with the tab counts. */
  async list(ctx: RequestContext, q: ListAppointmentsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.filterSql(q, params);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- w holds fixed fragments with numbered placeholders; values bound
        `SELECT count(*)::int AS n FROM appointments a LEFT JOIN appointment_hosts h ON h.id = a.host_id LEFT JOIN students s ON s.id = a.student_id WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w and the order are fixed fragments; values bound
        `${SELECT} WHERE ${w} ORDER BY ${q.order === 'time' ? 'a.starts_at NULLS LAST, a.id' : 'a.created_at DESC, a.id DESC'}
          LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const counts = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- DAY and TODAY are constants
        `SELECT count(*) FILTER (WHERE state = 'requested')::int AS open,
                count(*) FILTER (WHERE ${DAY('starts_at')} = ${TODAY} AND state NOT IN ('rejected', 'cancelled'))::int AS today,
                count(*) FILTER (WHERE state = 'approved' AND starts_at >= now())::int AS upcoming,
                count(*) FILTER (WHERE state = 'checked_in')::int AS inside
           FROM appointments`,
      );
      return {
        data: r.rows.map(toRow),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: {
          open: Number(counts.rows[0]?.open ?? 0),
          today: Number(counts.rows[0]?.today ?? 0),
          upcoming: Number(counts.rows[0]?.upcoming ?? 0),
          inside: Number(counts.rows[0]?.inside ?? 0),
        },
      };
    });
  }

  private async find(c: PoolClient, id: string): Promise<AppointmentRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is bound
    const r = await c.query<Row>(`${SELECT} WHERE a.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Appointment not found');
    return toRow(r.rows[0]);
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.find(c, id);
      const events = await c.query<Row>(
        `SELECT ev.kind, ev.at, ev.detail, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ev.actor_user_id LIMIT 1), u.display_name) AS actor
           FROM appointment_events ev LEFT JOIN users u ON u.id = ev.actor_user_id WHERE ev.appointment_id = $1 ORDER BY ev.at, ev.id`,
        [id],
      );
      const link = await this.passLink(c, row.passCode);
      const p = ctx.permissions;
      return {
        ...row,
        passLink: link,
        passQr: link ? await this.qrSvg(link) : null,
        events: events.rows.map((x) => ({
          kind: String(x.kind),
          at: iso(x.at)!,
          actor: text(x.actor),
          detail: (x.detail as Record<string, unknown>) ?? {},
        })),
        you: {
          canDecide: Boolean(p?.has('engagement.appointment.decide')),
          canCheckIn: Boolean(p?.has('engagement.appointment.checkin')),
        },
      };
    });
  }

  async photo(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ content_type: string; bytes: Buffer }>(
        `SELECT content_type, bytes FROM appointment_photos WHERE appointment_id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'No photo for this appointment');
      return { contentType: r.rows[0].content_type, bytes: r.rows[0].bytes };
    });
  }

  private async locked(c: PoolClient, id: string) {
    const r = await c.query<{
      state: AppointmentState;
      host_id: string | null;
      with_employee_id: string | null;
      student_id: string | null;
      has_slot: boolean;
    }>(
      `SELECT state, host_id::text, with_employee_id::text, student_id::text, starts_at IS NOT NULL AS has_slot
         FROM appointments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Appointment not found');
    return r.rows[0];
  }

  private wrongState(now: AppointmentState, doing: string): never {
    throw new DomainError(
      'appointment.wrong_state',
      `This appointment is ${STATE_LABEL[now].toLowerCase()}; it cannot be ${doing}`,
      { status: 409 },
    );
  }

  async approve(ctx: RequestContext, id: string, dto: ApproveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.locked(c, id);
      if (a.state !== 'requested') this.wrongState(a.state, 'confirmed');
      if (!a.has_slot)
        throw new DomainError(
          'appointment.no_slot',
          'This request has no slot yet; use Reschedule to give it one',
          { status: 409 },
        );
      await c.query(
        `UPDATE appointments SET state = 'approved', status = 'approved', confirmed_at = starts_at, decision_note = $2, location = COALESCE($3, location),
                pass_code = COALESCE(pass_code, $4), decided_by = app.current_user_id(), decided_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.note ?? null, dto.location ?? null, this.passCode()],
      );
      await this.event(c, id, 'approved', { note: dto.note ?? null });
      await this.notify(c, id, 'approved', dto.note);
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.approved',
        entityType: 'appointments',
        entityId: id,
        after: { note: dto.note ?? null, location: dto.location ?? null },
      });
      return { ok: true };
    });
  }

  async reject(ctx: RequestContext, id: string, dto: RejectDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.locked(c, id);
      if (a.state !== 'requested') this.wrongState(a.state, 'declined');
      await c.query(
        `UPDATE appointments SET state = 'rejected', status = 'rejected', decision_note = $2, decided_by = app.current_user_id(), decided_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      await this.event(c, id, 'rejected', { reason: dto.reason });
      await this.notify(c, id, 'rejected', dto.reason);
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.rejected',
        entityType: 'appointments',
        entityId: id,
        after: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  /** The front desk gives a new slot (and, if needed, another person or desk); it is confirmed at once. */
  async reschedule(ctx: RequestContext, id: string, dto: RescheduleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const a = await this.locked(c, id);
      if (!['requested', 'approved'].includes(a.state)) this.wrongState(a.state, 'moved');
      const hostId = dto.hostId ?? a.host_id;
      if (!hostId)
        throw new DomainError('validation-failed', 'Pick the person or desk to meet', {
          status: 400,
        });
      const host = await this.host(c, hostId);
      let withEmployee: string | null = null;
      if (host.kind === 'class_teacher') {
        withEmployee = a.student_id ? await this.classTeacher(c, a.student_id) : null;
        if (!withEmployee)
          throw new DomainError(
            'appointment.no_class_teacher',
            'A class teacher slot needs a pupil with a class teacher',
            { status: 409 },
          );
      }
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `appointment:${host.id}:${withEmployee ?? ''}:${dto.startsAt}`,
      ]);
      const { closed, slots } = await this.slots(
        c,
        s,
        host,
        dto.startsAt.slice(0, 10),
        withEmployee,
        {
          byDesk: true,
          excludeId: id,
        },
      );
      const slot = slots.find((x) => x.startsAt === dto.startsAt);
      if (closed || !slot)
        throw new DomainError(
          'appointment.no_slot',
          closed ?? 'There is no such slot; pick one from the list',
          {
            status: 409,
          },
        );
      if (!slot.available)
        throw new DomainError(
          'appointment.slot_taken',
          'That slot is full or has passed; pick another one',
          {
            status: 409,
          },
        );
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- TS is a constant fragment; values bound
        `UPDATE appointments SET previous_starts_at = starts_at, starts_at = ${TS(2)}, ends_at = ${TS(2)} + make_interval(mins => $3::int),
                confirmed_at = ${TS(2)}, host_id = $4, with_employee_id = $5, with_kind = $6, state = 'approved', status = 'approved',
                reschedule_count = reschedule_count + 1, reminder_sent_at = NULL, decision_note = $7, location = COALESCE($8, location),
                pass_code = COALESCE(pass_code, $9), decided_by = app.current_user_id(), decided_at = now(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.startsAt,
          host.slotMinutes,
          host.id,
          withEmployee,
          host.kind === 'class_teacher' ? 'class_teacher' : null,
          dto.reason ?? null,
          dto.location ?? null,
          this.passCode(),
        ],
      );
      await this.event(c, id, 'rescheduled', {
        startsAt: dto.startsAt,
        host: host.name,
        reason: dto.reason ?? null,
      });
      await this.notify(c, id, 'rescheduled', dto.reason);
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.rescheduled',
        entityType: 'appointments',
        entityId: id,
        after: { startsAt: dto.startsAt, hostId: host.id, reason: dto.reason ?? null },
      });
      return { ok: true };
    });
  }

  private async cancelWith(c: PoolClient, id: string, reason: string | null, by: string) {
    const a = await this.locked(c, id);
    if (!['requested', 'approved'].includes(a.state)) this.wrongState(a.state, 'cancelled');
    await c.query(
      `UPDATE appointments SET state = 'cancelled', status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1`,
      [id, reason],
    );
    await this.event(c, id, 'cancelled', { reason, by });
    await this.notify(c, id, 'cancelled', reason);
  }

  async cancel(ctx: RequestContext, id: string, dto: CancelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cancelWith(c, id, dto.reason ?? null, 'front_desk');
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.cancelled',
        entityType: 'appointments',
        entityId: id,
        after: { reason: dto.reason ?? null },
      });
      return { ok: true };
    });
  }

  // ---- gate -----------------------------------------------------------------------------------------
  /** A pass scanned or typed at the gate: the code (or the pass link), the number, or today's mobile. */
  async gateFind(ctx: RequestContext, code: string) {
    const key = (code.includes('/') ? code.split(/[/?#]/).filter(Boolean).pop()! : code).trim();
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT, DAY and TODAY are constants; the key is bound
        `${SELECT} WHERE upper(a.pass_code) = upper($1) OR a.number = upper($1)
            OR (a.visitor_mobile = $1 AND ${DAY('a.starts_at')} = ${TODAY})
          ORDER BY (a.state IN ('approved', 'checked_in')) DESC, a.starts_at DESC NULLS LAST LIMIT 5`,
        [key],
      );
      return { data: r.rows.map(toRow) };
    });
  }

  /** Arrival: the appointment becomes the visitor-log entry (in time now). */
  async checkIn(ctx: RequestContext, id: string, dto: CheckInDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.locked(c, id);
      if (a.state === 'requested')
        throw new DomainError(
          'appointment.not_confirmed',
          'This appointment is not confirmed yet; ask the front desk',
          { status: 409 },
        );
      if (a.state !== 'approved') this.wrongState(a.state, 'checked in');
      const v = await c.query<{ id: string }>(
        `INSERT INTO visitor_log (school_id, visitor_name, mobile, organisation, purpose, to_meet, id_proof_kind, badge_no, logged_by)
         SELECT app.current_school_id(), COALESCE(ap.visitor_name, st.display_name, 'Visitor'), ap.visitor_mobile, ap.visitor_org,
                left(ap.purpose, 300) || ' (' || ap.number || ')', COALESCE(e.display_name, he.display_name, h.name), ap.id_proof_kind, $2, app.current_user_id()
           FROM appointments ap LEFT JOIN appointment_hosts h ON h.id = ap.host_id LEFT JOIN employees e ON e.id = ap.with_employee_id
           LEFT JOIN employees he ON he.id = h.employee_id LEFT JOIN students st ON st.id = ap.student_id
          WHERE ap.id = $1 RETURNING id::text`,
        [id, dto.badgeNo ?? null],
      );
      await c.query(
        `UPDATE appointments SET state = 'checked_in', checked_in_at = now(), visitor_log_id = $2, updated_at = now() WHERE id = $1`,
        [id, v.rows[0]!.id],
      );
      await this.event(c, id, 'checked_in', { badgeNo: dto.badgeNo ?? null });
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.checked_in',
        entityType: 'appointments',
        entityId: id,
        after: { visitorLogId: v.rows[0]!.id },
      });
      return { ok: true, visitorLogId: v.rows[0]!.id };
    });
  }

  async checkOut(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.locked(c, id);
      if (a.state !== 'checked_in') this.wrongState(a.state, 'checked out');
      await c.query(
        `UPDATE visitor_log SET out_at = now() WHERE id = (SELECT visitor_log_id FROM appointments WHERE id = $1) AND out_at IS NULL`,
        [id],
      );
      await c.query(
        `UPDATE appointments SET state = 'completed', checked_out_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.event(c, id, 'checked_out');
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.checked_out',
        entityType: 'appointments',
        entityId: id,
      });
      return { ok: true };
    });
  }

  async noShow(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.locked(c, id);
      if (a.state !== 'approved') this.wrongState(a.state, 'marked as not come');
      await c.query(`UPDATE appointments SET state = 'no_show', updated_at = now() WHERE id = $1`, [
        id,
      ]);
      await this.event(c, id, 'no_show');
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.no_show',
        entityType: 'appointments',
        entityId: id,
      });
      return { ok: true };
    });
  }

  // ---- calendar, dashboard, Excel -------------------------------------------------------------------
  async calendar(ctx: RequestContext, q: CalendarQueryDto) {
    if (q.to < q.from || (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 45)
      throw new DomainError('validation-failed', 'Pick up to 45 days', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const params: unknown[] = [q.from, q.to];
      const more: string[] = [];
      if (q.hostId) {
        params.push(q.hostId);
        more.push(`a.host_id = $${String(params.length)}`);
      }
      if (q.mine)
        more.push(
          `COALESCE(a.with_employee_id, h.employee_id) = (SELECT me.id FROM employees me WHERE me.user_id = app.current_user_id() AND me.deleted_at IS NULL LIMIT 1)`,
        );
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and DAY are constants; more holds fixed fragments; values bound
        `${SELECT} WHERE a.starts_at IS NOT NULL AND ${DAY('a.starts_at')} BETWEEN $1::date AND $2::date
            AND a.state NOT IN ('rejected', 'cancelled') ${more.length ? `AND ${more.join(' AND ')}` : ''}
          ORDER BY a.starts_at, a.id LIMIT 2000`,
        params,
      );
      const closed = await c.query<{ d: string; name: string }>(
        `SELECT to_char(g::date, 'YYYY-MM-DD') AS d, hd.name FROM generate_series($1::date, $2::date, interval '1 day') g
           JOIN holidays hd ON hd.kind <> 'working_day' AND hd.applies_to <> 'students' AND g::date BETWEEN hd.starts_on AND hd.ends_on`,
        [q.from, q.to],
      );
      return {
        data: r.rows.map(toRow),
        hosts: await this.hostsFor(c, 'desk'),
        closed: closed.rows,
      };
    });
  }

  /** Today, what is waiting, the next seven days, six months of outcomes, the busiest desks and purposes. */
  async dashboard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const today = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- DAY and TODAY are constants
        `SELECT count(*) FILTER (WHERE ${DAY('starts_at')} = ${TODAY} AND state NOT IN ('rejected', 'cancelled'))::int AS today,
                count(*) FILTER (WHERE ${DAY('starts_at')} = ${TODAY} AND state = 'approved')::int AS expected,
                count(*) FILTER (WHERE state = 'checked_in')::int AS inside,
                count(*) FILTER (WHERE ${DAY('starts_at')} = ${TODAY} AND state = 'completed')::int AS done,
                count(*) FILTER (WHERE ${DAY('starts_at')} = ${TODAY} AND state = 'no_show')::int AS no_show,
                count(*) FILTER (WHERE state = 'requested')::int AS waiting,
                count(*) FILTER (WHERE state = 'requested' AND created_at < now() - interval '4 hours')::int AS waiting_long
           FROM appointments`,
      );
      const week = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- DAY and TODAY are constants
        `SELECT to_char(g::date, 'YYYY-MM-DD') AS day,
                (SELECT count(*)::int FROM appointments a WHERE ${DAY('a.starts_at')} = g::date AND a.state IN ('approved', 'checked_in', 'completed')) AS confirmed,
                (SELECT count(*)::int FROM appointments a WHERE ${DAY('a.starts_at')} = g::date AND a.state = 'requested') AS waiting
           FROM generate_series(${TODAY}, ${TODAY} + 6, interval '1 day') g ORDER BY 1`,
      );
      const months = await c.query<Row>(
        `WITH mo AS (SELECT to_char(m, 'YYYY-MM') AS month, (m::date::timestamp AT TIME ZONE 'Asia/Kolkata') AS starts,
                            ((m + interval '1 month')::date::timestamp AT TIME ZONE 'Asia/Kolkata') AS ends
                       FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months',
                                            date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 month') m)
         SELECT mo.month,
                count(a.id)::int AS total,
                count(a.id) FILTER (WHERE a.source = 'public')::int AS from_public,
                count(a.id) FILTER (WHERE a.source = 'parent')::int AS from_parent,
                count(a.id) FILTER (WHERE a.source = 'front_desk')::int AS from_desk,
                count(a.id) FILTER (WHERE a.state IN ('approved', 'checked_in', 'completed', 'no_show'))::int AS confirmed,
                count(a.id) FILTER (WHERE a.state = 'rejected')::int AS rejected,
                count(a.id) FILTER (WHERE a.state = 'cancelled')::int AS cancelled,
                count(a.id) FILTER (WHERE a.state = 'completed')::int AS completed,
                count(a.id) FILTER (WHERE a.state = 'no_show')::int AS no_show,
                count(a.id) FILTER (WHERE a.reschedule_count > 0)::int AS rescheduled,
                round((avg(extract(epoch FROM a.decided_at - a.created_at) / 3600) FILTER (WHERE a.decided_at IS NOT NULL AND a.source <> 'front_desk'))::numeric, 1)::float AS decide_hours
           FROM mo LEFT JOIN appointments a ON a.created_at >= mo.starts AND a.created_at < mo.ends
          GROUP BY mo.month ORDER BY mo.month`,
      );
      const hosts = await c.query<Row>(
        `SELECT COALESCE(h.name, 'Not set') AS name, count(*)::int AS total,
                count(*) FILTER (WHERE a.state = 'no_show')::int AS no_show
           FROM appointments a LEFT JOIN appointment_hosts h ON h.id = a.host_id
          WHERE a.created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      );
      const purposes = await c.query<Row>(
        `SELECT left(a.purpose, 60) AS name, count(*)::int AS total FROM appointments a
          WHERE a.created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      );
      const t = today.rows[0]!;
      const num = (v: unknown) => Number(v ?? 0);
      return {
        today: {
          total: num(t.today),
          expected: num(t.expected),
          inside: num(t.inside),
          done: num(t.done),
          noShow: num(t.no_show),
        },
        waiting: num(t.waiting),
        waitingLong: num(t.waiting_long),
        week: week.rows.map((x) => ({
          day: String(x.day),
          confirmed: num(x.confirmed),
          waiting: num(x.waiting),
        })),
        months: months.rows.map((x) => ({
          month: String(x.month),
          total: num(x.total),
          fromPublic: num(x.from_public),
          fromParent: num(x.from_parent),
          fromDesk: num(x.from_desk),
          confirmed: num(x.confirmed),
          rejected: num(x.rejected),
          cancelled: num(x.cancelled),
          completed: num(x.completed),
          noShow: num(x.no_show),
          rescheduled: num(x.rescheduled),
          decideHours: (x.decide_hours as number | null) ?? null,
        })),
        hosts: hosts.rows.map((x) => ({
          name: String(x.name),
          total: num(x.total),
          noShow: num(x.no_show),
        })),
        purposes: purposes.rows.map((x) => ({ name: String(x.name), total: num(x.total) })),
      };
    });
  }

  /** The list as it is filtered on screen, as Excel. */
  async report(
    ctx: RequestContext,
    q: ExportAppointmentsDto,
  ): Promise<{ bytes: Buffer; filename: string }> {
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.filterSql(q, params);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w and the order are fixed fragments; the limit is a number
        `${SELECT} WHERE ${w} ORDER BY ${q.order === 'time' ? 'a.starts_at NULLS LAST, a.id' : 'a.created_at DESC, a.id DESC'} LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toRow);
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Appointments');
    ws.addRow([`Appointments · ${String(rows.length)} rows`]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.addRow([
      'Number',
      'Booked on',
      'From',
      'Visitor',
      'Mobile',
      'Organisation',
      'People',
      'Student',
      'Class',
      'To meet',
      'Purpose',
      'Visit time',
      'Status',
      'Decided by',
      'Rescheduled',
      'Arrived',
      'Left',
      'Note',
    ]).font = { bold: true };
    const SOURCE = { parent: 'Parent app', public: 'QR / outside', front_desk: 'Front desk' };
    for (const a of rows)
      ws.addRow([
        a.number,
        ist(a.createdAt),
        SOURCE[a.source],
        a.visitorName ?? '',
        a.visitorMobile ?? '',
        a.visitorOrg ?? '',
        a.partySize,
        a.student ?? '',
        a.section ?? '',
        [a.hostName, a.withName].filter(Boolean).join(' · '),
        a.purpose,
        ist(a.startsAt),
        STATE_LABEL[a.state],
        a.decidedBy ?? '',
        a.rescheduleCount || '',
        ist(a.checkedInAt),
        ist(a.checkedOutAt),
        a.decisionNote ?? a.cancelReason ?? '',
      ]);
    [15, 18, 13, 24, 13, 22, 7, 24, 9, 26, 36, 18, 14, 20, 11, 18, 18, 34].forEach((w, i) => {
      ws.getColumn(i + 1).width = w;
    });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `appointments-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  // ---- set-up (admin) -------------------------------------------------------------------------------
  private qrSvg(value: string): Promise<string> {
    return QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const settings = await this.settings(c);
      // eslint-disable-next-line no-restricted-syntax -- HOST_SELECT is a constant
      const hosts = await c.query<Row>(`${HOST_SELECT} ORDER BY h.sort_order, h.name`);
      const hours = await c.query<{
        host_id: string;
        weekday: number;
        starts: string;
        ends: string;
      }>(
        `SELECT host_id::text, weekday, to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends
           FROM appointment_host_hours ORDER BY host_id, weekday, starts`,
      );
      const used = await c.query<{ host_id: string; n: number }>(
        `SELECT host_id::text, count(*)::int AS n FROM appointments WHERE host_id IS NOT NULL GROUP BY 1`,
      );
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT e.id::text, e.display_name || COALESCE(' · ' || e.designation, '') || COALESCE(' · ' || e.employee_code, '') AS name
           FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY 2 LIMIT 3000`,
      );
      // which messages can go out: a channel needs an active template (SMS also its DLT id, WhatsApp its approved name)
      const templates = await c.query<Row>(
        `SELECT t.code, t.channel::text, t.name, t.status::text, (t.dlt_template_id IS NOT NULL AND btrim(t.dlt_template_id) <> '') AS has_dlt,
                (t.wa_template_name IS NOT NULL AND btrim(t.wa_template_name) <> '') AS has_wa
           FROM comms_templates t WHERE t.code LIKE 'appointment\\_%' AND t.deleted_at IS NULL ORDER BY t.code, t.channel`,
      );
      const school = await c.query<{ code: string; name: string }>(
        `SELECT lower(code) AS code, name FROM schools WHERE id = app.current_school_id()`,
      );
      const url = `${this.env.PUBLIC_APP_URL.replace(/\/$/, '')}/${school.rows[0]!.code}/appointment`;
      return {
        settings,
        hosts: hosts.rows.map(toHost).map((h) => ({
          ...h,
          used: used.rows.find((u) => u.host_id === h.id)?.n ?? 0,
          hours: hours.rows
            .filter((x) => x.host_id === h.id)
            .map((x) => ({ weekday: x.weekday, starts: x.starts, ends: x.ends })),
        })),
        staff: staff.rows,
        templates: templates.rows.map((t) => ({
          code: String(t.code),
          channel: String(t.channel),
          name: String(t.name),
          active: t.status === 'active',
          ready:
            t.status === 'active' &&
            (t.channel === 'email' ||
              (t.channel === 'sms' ? Boolean(t.has_dlt) : Boolean(t.has_wa))),
        })),
        booking: { url, qr: await this.qrSvg(url), school: school.rows[0]!.name },
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: AppointmentSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      await c.query(
        `UPDATE appointment_settings SET public_enabled = $1, auto_approve = $2, min_notice_hours = $3, max_days_ahead = $4, max_party = $5,
                ask_organisation = $6, ask_id_proof = $7, ask_photo = $8, id_proof_kinds = $9::text[], purposes = $10::text[],
                notify_sms = $11, notify_whatsapp = $12, notify_email = $13, reminder_hours = $14, no_show_minutes = $15,
                closed_dates = $16::date[], instructions = $17, updated_at = now(), updated_by = app.current_user_id()
          WHERE school_id = app.current_school_id()`,
        [
          dto.publicEnabled,
          dto.autoApprove,
          dto.minNoticeHours,
          dto.maxDaysAhead,
          dto.maxParty,
          dto.askOrganisation,
          dto.askIdProof,
          dto.askPhoto,
          dto.idProofKinds,
          dto.purposes,
          dto.notifySms,
          dto.notifyWhatsapp,
          dto.notifyEmail,
          dto.reminderHours,
          dto.noShowMinutes,
          dto.closedDates,
          dto.instructions ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment_setup.settings',
        entityType: 'appointment_settings',
        after: { ...dto },
      });
      return { ok: true };
    });
  }

  async saveHost(ctx: RequestContext, id: string | null, dto: HostDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const clash = await c.query(
        `SELECT 1 FROM appointment_hosts WHERE lower(name) = lower($1) AND ($2::bigint IS NULL OR id <> $2)`,
        [dto.name, id],
      );
      if (clash.rowCount)
        throw new DomainError('appointment.host_exists', `"${dto.name}" is already on the list`, {
          status: 409,
        });
      const values = [
        dto.name,
        dto.kind,
        dto.kind === 'person' ? dto.employeeId : null,
        dto.location ?? null,
        dto.openPublic,
        dto.openParent,
        dto.slotMinutes,
        dto.capacity,
        dto.sortOrder,
        dto.status,
      ];
      let hostId = id;
      if (id) {
        const r = await c.query(
          `UPDATE appointment_hosts SET name = $2, kind = $3, employee_id = $4, location = $5, open_public = $6, open_parent = $7, slot_minutes = $8,
                  capacity = $9, sort_order = $10, status = $11::row_status, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, ...values],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'That person or desk was not found');
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO appointment_hosts (school_id, name, kind, employee_id, location, open_public, open_parent, slot_minutes, capacity, sort_order, status, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::row_status, app.current_user_id()) RETURNING id::text`,
          values,
        );
        hostId = r.rows[0]!.id;
      }
      await c.query(`DELETE FROM appointment_host_hours WHERE host_id = $1`, [hostId]);
      for (const h of dto.hours)
        await c.query(
          `INSERT INTO appointment_host_hours (school_id, host_id, weekday, starts, ends) VALUES (app.current_school_id(), $1, $2, $3::time, $4::time)`,
          [hostId, h.weekday, h.starts, h.ends],
        );
      await this.audit.stage(ctx, c, {
        action: id
          ? 'engagement.appointment_setup.host_update'
          : 'engagement.appointment_setup.host_create',
        entityType: 'appointment_hosts',
        entityId: hostId!,
        after: { ...dto },
      });
      return { id: hostId! };
    });
  }

  // ---- parents (the parent app) ---------------------------------------------------------------------
  private async family(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view');
    if (v.kind !== 'family')
      throw new DomainError('forbidden', 'Only a parent or student can do this here', {
        status: 403,
      });
    return v;
  }

  async familyHosts(ctx: RequestContext) {
    await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      return {
        data: await this.hostsFor(c, 'parent'),
        purposes: s.purposes,
        maxDaysAhead: s.maxDaysAhead,
        instructions: s.instructions,
      };
    });
  }

  async familySlots(ctx: RequestContext, q: SlotsQueryDto) {
    const v = await this.family(ctx);
    if (q.studentId && !v.students.some((x) => x.id === q.studentId))
      throw new DomainError('not-found', 'Student not found');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const host = await this.host(c, q.hostId);
      if (!host.openParent || host.status !== 'active')
        throw new DomainError('not-found', 'That person or desk was not found');
      const withEmployee =
        host.kind === 'class_teacher' && q.studentId
          ? await this.classTeacher(c, q.studentId)
          : null;
      if (host.kind === 'class_teacher' && !withEmployee)
        return { closed: 'No class teacher is set for this class yet.', slots: [] };
      return this.slots(c, s, host, q.date, withEmployee, { byDesk: false });
    });
  }

  async familyBook(ctx: RequestContext, dto: FamilyBookDto) {
    const v = await this.family(ctx);
    if (!v.students.some((x) => x.id === dto.studentId))
      throw new DomainError('not-found', 'Student not found');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const me = await c.query<{
        id: string;
        name: string;
        mobile: string | null;
        email: string | null;
      }>(
        `SELECT id::text, display_name AS name, mobile, email::text FROM users WHERE id = app.current_user_id()`,
      );
      const out = await this.place(c, s, {
        source: 'parent',
        hostId: dto.hostId,
        startsAt: dto.startsAt,
        purpose: dto.purpose,
        studentId: dto.studentId,
        visitorName: me.rows[0]?.name ?? null,
        visitorMobile: me.rows[0]?.mobile ?? null,
        visitorEmail: me.rows[0]?.email ?? null,
        visitorOrg: null,
        partySize: 1,
        idProofKind: null,
        idProofLast4: null,
        photo: null,
        requestedBy: me.rows[0]!.id,
        applicantId: null,
        approve: false,
        byDesk: false,
      });
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.request',
        entityType: 'appointments',
        entityId: out.id,
        after: { studentId: dto.studentId, hostId: dto.hostId, startsAt: dto.startsAt },
      });
      return out;
    });
  }

  async familyList(ctx: RequestContext) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values bound
        `${SELECT} WHERE a.student_id = ANY($1::bigint[]) ORDER BY a.created_at DESC, a.id DESC LIMIT 50`,
        [v.students.map((s) => s.id)],
      );
      const rows = r.rows.map(toRow);
      return {
        data: await Promise.all(
          rows.map(async (a) => {
            const link = ['approved', 'checked_in'].includes(a.state)
              ? await this.passLink(c, a.passCode)
              : null;
            return { ...a, passLink: link };
          }),
        ),
      };
    });
  }

  async familyCancel(ctx: RequestContext, id: string, dto: CancelDto) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const own = await c.query(
        `SELECT 1 FROM appointments WHERE id = $1 AND student_id = ANY($2::bigint[])`,
        [id, v.students.map((s) => s.id)],
      );
      if (!own.rowCount) throw new DomainError('not-found', 'Appointment not found');
      await this.cancelWith(c, id, dto.reason ?? 'Cancelled by the parent', 'parent');
      await this.audit.stage(ctx, c, {
        action: 'engagement.appointment.cancelled',
        entityType: 'appointments',
        entityId: id,
        after: { by: 'parent' },
      });
      return { ok: true };
    });
  }

  // ---- outside visitors (the public page behind the school's QR code) -------------------------------
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

  /** What the booking page shows before anyone signs in: the desks, the purposes, what is asked. */
  async publicInfo(schoolCode: string) {
    const tenant = await this.publicSchool(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const s = await this.settings(c);
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return {
        school: school.rows[0]!.name,
        enabled: s.publicEnabled,
        hosts: s.publicEnabled ? await this.hostsFor(c, 'public') : [],
        purposes: s.purposes,
        idProofKinds: s.idProofKinds,
        ask: { organisation: s.askOrganisation, idProof: s.askIdProof, photo: s.askPhoto },
        maxParty: s.maxParty,
        maxDaysAhead: s.maxDaysAhead,
        instructions: s.instructions,
      };
    });
  }

  async publicSlots(schoolCode: string, q: SlotsQueryDto) {
    const tenant = await this.publicSchool(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      const s = await this.settings(c);
      if (!s.publicEnabled) return { closed: 'Online booking is closed.', slots: [] };
      const host = await this.host(c, q.hostId);
      if (!host.openPublic || host.status !== 'active')
        throw new DomainError('not-found', 'That person or desk was not found');
      const out = await this.slots(c, s, host, q.date, null, { byDesk: false });
      // an outsider learns only whether a slot can be taken, not how busy the desk is
      return {
        closed: out.closed,
        slots: out.slots.map((x) => ({
          time: x.time,
          startsAt: x.startsAt,
          available: x.available,
        })),
      };
    });
  }

  async publicBook(applicant: Applicant, dto: PublicBookDto) {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      const s = await this.settings(c);
      if (!s.publicEnabled)
        throw new DomainError('appointment.public_closed', 'Online booking is closed', {
          status: 409,
        });
      const need = (rule: string, value: unknown, label: string) => {
        if (rule === 'required' && !value)
          throw new DomainError('validation-failed', `${label} is required`, { status: 400 });
      };
      need(s.askOrganisation, dto.visitorOrg, 'Where you are coming from');
      need(
        s.askIdProof,
        dto.idProofKind && dto.idProofLast4,
        'An ID proof and its last 4 characters',
      );
      need(s.askPhoto, dto.photo, 'Your photo');
      if (dto.idProofKind && !s.idProofKinds.includes(dto.idProofKind))
        throw new DomainError('validation-failed', 'Pick an ID proof from the list', {
          status: 400,
        });
      await c.query(
        `UPDATE applicants SET name = $2, email = COALESCE($3::citext, email) WHERE id = $1`,
        [applicant.id, dto.visitorName, dto.visitorEmail ?? null],
      );
      return this.place(c, s, {
        source: 'public',
        hostId: dto.hostId,
        startsAt: dto.startsAt,
        purpose: dto.purpose,
        studentId: null,
        visitorName: dto.visitorName,
        visitorMobile: applicant.mobile,
        visitorEmail: dto.visitorEmail ?? null,
        visitorOrg: s.askOrganisation === 'off' ? null : (dto.visitorOrg ?? null),
        partySize: dto.partySize,
        idProofKind: s.askIdProof === 'off' ? null : (dto.idProofKind ?? null),
        idProofLast4: s.askIdProof === 'off' ? null : (dto.idProofLast4 ?? null),
        photo: s.askPhoto === 'off' ? null : (dto.photo ?? null),
        requestedBy: null,
        applicantId: applicant.id,
        approve: false,
        byDesk: false,
      });
    });
  }

  private publicView(a: AppointmentRow, link: string | null, qr: string | null) {
    return {
      id: a.id,
      number: a.number,
      state: a.state,
      host: a.hostName,
      place: a.place,
      startsAt: a.startsAt,
      purpose: a.purpose,
      visitorName: a.visitorName,
      partySize: a.partySize,
      note: a.decisionNote ?? a.cancelReason,
      createdAt: a.createdAt,
      passLink: link,
      passQr: qr,
    };
  }

  async publicMine(applicant: Applicant) {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values bound
        `${SELECT} WHERE a.applicant_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 30`,
        [applicant.id],
      );
      const data = [];
      for (const a of r.rows.map(toRow)) {
        const live = ['approved', 'checked_in'].includes(a.state);
        const link = live ? await this.passLink(c, a.passCode) : null;
        data.push(this.publicView(a, link, link ? await this.qrSvg(link) : null));
      }
      return { data };
    });
  }

  async publicCancel(applicant: Applicant, id: string, dto: CancelDto) {
    return this.db.tenant(publicTenant(applicant.schoolId), async (c) => {
      const own = await c.query(`SELECT 1 FROM appointments WHERE id = $1 AND applicant_id = $2`, [
        id,
        applicant.id,
      ]);
      if (!own.rowCount) throw new DomainError('not-found', 'Appointment not found');
      await this.cancelWith(c, id, dto.reason ?? 'Cancelled by the visitor', 'visitor');
      return { ok: true };
    });
  }

  /** The pass behind the link in the confirmation message (the code is the secret). */
  async publicPass(schoolCode: string, code: string) {
    if (!/^[A-Za-z0-9]{8,16}$/.test(code)) throw new DomainError('not-found', 'Pass not found');
    const tenant = await this.publicSchool(schoolCode);
    return this.db.tenant(tenant, async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the code is bound
      const r = await c.query<Row>(`${SELECT} WHERE upper(a.pass_code) = upper($1)`, [code]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Pass not found');
      const a = toRow(r.rows[0]);
      const s = await this.settings(c);
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      const link = await this.passLink(c, a.passCode);
      const live = ['approved', 'checked_in'].includes(a.state);
      return {
        ...this.publicView(a, link, live && link ? await this.qrSvg(link) : null),
        // a pass shows the first name only; the gate sees the full record on its own screen
        visitorName: (a.visitorName ?? '').split(' ')[0] ?? '',
        school: school.rows[0]!.name,
        instructions: s.instructions,
      };
    });
  }
}
