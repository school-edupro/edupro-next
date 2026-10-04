import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import bwipjs from 'bwip-js';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
import { readStudentProfile, type PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { FilesService } from '../files/files.service';
import { STORAGE_DRIVER } from '../files/storage';
import {
  GATE,
  type ExportPassesDto,
  type GateInDto,
  type GateOutDto,
  type GatePassSetupDto,
  type HandoverDto,
  type ListPassesDto,
  type MyPassesDto,
  type PassCancelDto,
  type PassDecideDto,
  type PassState,
  type StaffPassDto,
  type StudentPassDto,
} from './gatepass.dto';
import { qrPng, visitorCardPdf } from './visitor-card';

type Row = Record<string, unknown>;
type Audience = 'student' | 'staff';
type Party = 'student' | 'father' | 'mother' | 'guardian';

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : null);
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EXPORT_MAX = 5000;
const OTP_MINUTES = 10;
const ist = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const SELECT = `SELECT p.id::text, p.audience, p.kind, p.source, p.state, p.on_date::text, to_char(p.at_time, 'HH24:MI') AS at_time, p.return_by,
       p.reason, p.destination, p.student_id::text, s.display_name AS student, s.admission_no,
       (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
         WHERE en.student_id = s.id AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1) AS section,
       p.employee_id::text, e.display_name AS employee, e.employee_code, e.designation,
       p.escort_kind, p.escort_name, p.escort_relation, p.escort_mobile, p.pass_no, p.pass_code, p.approval_mode, p.approval_need,
       p.decided_at, p.decision_note, p.handover_at, hu.display_name AS handover_by, p.otp_verified_at, p.out_at, p.out_gate, p.in_at,
       p.gate_note, p.cancel_reason, ru.display_name AS requested_by, p.requested_by::text AS requested_by_id, p.created_at,
       EXISTS (SELECT 1 FROM gate_pass_photos ph WHERE ph.pass_id = p.id) AS has_photo,
       (SELECT count(*) FROM gate_pass_approvals a WHERE a.pass_id = p.id AND a.status = 'approved')::int AS approved_n,
       (SELECT count(*) FROM gate_pass_approvals a WHERE a.pass_id = p.id AND a.status <> 'skipped')::int AS levels_n,
       (SELECT string_agg(a.label, ', ' ORDER BY a.seq) FROM gate_pass_approvals a WHERE a.pass_id = p.id AND a.status = 'pending') AS waiting_on,
       (SELECT count(*) FROM gate_pass_items i WHERE i.pass_id = p.id)::int AS items_n,
       (SELECT count(*) FROM gate_pass_items i WHERE i.pass_id = p.id AND i.returnable AND i.returned_qty < i.qty)::int AS items_due
  FROM gate_passes p
  LEFT JOIN students s ON s.id = p.student_id
  LEFT JOIN employees e ON e.id = p.employee_id
  LEFT JOIN users ru ON ru.id = p.requested_by
  LEFT JOIN users hu ON hu.id = p.handover_by`;
const FROM = `FROM gate_passes p LEFT JOIN students s ON s.id = p.student_id LEFT JOIN employees e ON e.id = p.employee_id`;

/** Where a pass stands for the people who work it. */
const STAGE_SQL: Record<string, string> = {
  approval: `p.state = 'pending'`,
  handover: `p.state = 'approved' AND p.audience = 'student' AND p.kind = 'early_leave'`,
  gate: `(p.state = 'handed_over' OR (p.state = 'approved' AND NOT (p.audience = 'student' AND p.kind = 'early_leave')))`,
  out: `p.state = 'out' AND p.kind = 'rgp'`,
  closed: `(p.state IN ('returned', 'rejected', 'cancelled') OR (p.state = 'out' AND p.kind <> 'rgp'))`,
  today: `p.on_date = ${TODAY}`,
  all: `true`,
};

export interface PassRow {
  id: string;
  /** The pass number once approved; before that the request number. */
  number: string;
  audience: Audience;
  kind: 'early_leave' | 'late_arrival' | 'rgp' | 'nrgp';
  source: string;
  state: PassState;
  stage: string;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  reason: string;
  destination: string | null;
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  employeeId: string | null;
  employee: string | null;
  employeeCode: string | null;
  designation: string | null;
  escortKind: string | null;
  escortName: string | null;
  escortRelation: string | null;
  escortMobile: string | null;
  passNo: string | null;
  passCode: string | null;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  approvedLevels: number;
  levels: number;
  waitingOn: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  handoverAt: string | null;
  handoverBy: string | null;
  otpVerified: boolean;
  outAt: string | null;
  outGate: string | null;
  inAt: string | null;
  gateNote: string | null;
  cancelReason: string | null;
  requestedBy: string | null;
  requestedById: string | null;
  createdAt: string;
  hasPhoto: boolean;
  items: number;
  itemsDue: number;
}

function stageOf(x: { state: string; audience: string; kind: string }): string {
  if (x.state === 'pending') return 'Waiting for approval';
  if (x.state === 'approved')
    return x.audience === 'student' && x.kind === 'early_leave'
      ? 'Approved: hand over at the front desk'
      : 'Approved: show at the gate';
  if (x.state === 'handed_over') return 'Handed over: going to the gate';
  if (x.state === 'out') return x.kind === 'rgp' ? 'Out: to come back' : 'Left the campus';
  if (x.state === 'returned') return x.kind === 'late_arrival' ? 'Came in' : 'Back in the campus';
  return x.state === 'rejected' ? 'Not approved' : 'Cancelled';
}

const toRow = (x: Row): PassRow => ({
  id: String(x.id),
  number: text(x.pass_no) ?? `REQ-${String(x.id)}`,
  audience: x.audience as Audience,
  kind: x.kind as PassRow['kind'],
  source: String(x.source),
  state: x.state as PassState,
  stage: stageOf({ state: String(x.state), audience: String(x.audience), kind: String(x.kind) }),
  onDate: String(x.on_date),
  atTime: text(x.at_time),
  returnBy: iso(x.return_by),
  reason: String(x.reason),
  destination: text(x.destination),
  studentId: text(x.student_id),
  student: text(x.student),
  admissionNo: text(x.admission_no),
  section: text(x.section),
  employeeId: text(x.employee_id),
  employee: text(x.employee),
  employeeCode: text(x.employee_code),
  designation: text(x.designation),
  escortKind: text(x.escort_kind),
  escortName: text(x.escort_name),
  escortRelation: text(x.escort_relation),
  escortMobile: text(x.escort_mobile),
  passNo: text(x.pass_no),
  passCode: text(x.pass_code),
  approvalMode: x.approval_mode as 'sequence' | 'any',
  approvalNeed: Number(x.approval_need),
  approvedLevels: Number(x.approved_n ?? 0),
  levels: Number(x.levels_n ?? 0),
  waitingOn: text(x.waiting_on),
  decidedAt: iso(x.decided_at),
  decisionNote: text(x.decision_note),
  handoverAt: iso(x.handover_at),
  handoverBy: text(x.handover_by),
  otpVerified: Boolean(x.otp_verified_at),
  outAt: iso(x.out_at),
  outGate: text(x.out_gate),
  inAt: iso(x.in_at),
  gateNote: text(x.gate_note),
  cancelReason: text(x.cancel_reason),
  requestedBy: text(x.requested_by),
  requestedById: text(x.requested_by_id),
  createdAt: iso(x.created_at)!,
  hasPhoto: Boolean(x.has_photo),
  items: Number(x.items_n ?? 0),
  itemsDue: Number(x.items_due ?? 0),
});

const KIND_LABEL: Record<string, string> = {
  early_leave: 'Early leave',
  late_arrival: 'Late arrival',
  rgp: 'RGP (returnable)',
  nrgp: 'NRGP (non-returnable)',
};
/** The person a pass is for, on one line. */
export const whoOfPass = (p: PassRow): string =>
  p.audience === 'student'
    ? `${p.student ?? 'Student'}${p.section ? ` (${p.section})` : ''}${p.admissionNo ? ` · Adm. no. ${p.admissionNo}` : ''}`
    : `${p.employee ?? 'Employee'}${p.employeeCode ? ` · ${p.employeeCode}` : ''}`;

export interface Settings {
  studentMode: 'sequence' | 'any';
  studentNeed: number;
  staffMode: 'sequence' | 'any';
  staffNeed: number;
  handoverOtp: boolean;
  notifyEmail: boolean;
}
export interface Level {
  id: string;
  audience: Audience;
  seq: number;
  label: string;
  kind: 'class_teacher' | 'role' | 'designation' | 'employee';
  roleCode: string | null;
  designation: string | null;
  employeeId: string | null;
  employeeName: string | null;
  active: boolean;
}

/**
 * Gate pass v2 (0069). A pupil's pass (early leave with a parent, guardian or someone else; late
 * arrival) is asked by the family or made at the front desk, approved by the school's own levels, handed
 * over at the front desk (photos on record compared, a live photo of the collector, a one-time code to the
 * parent for an outsider) and closed by the gate keeper. A staff pass (RGP / NRGP, with the equipment
 * carried out) is asked by the employee, approved the same way and closed at the gate (out, and back in).
 */
@Injectable()
export class GatePassService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
    @Inject(ENV) private readonly env: Env,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private may(ctx: RequestContext, permission: string): boolean {
    return ctx.permissions?.has(permission) ?? false;
  }

  // ---- set-up ---------------------------------------------------------------------------------------
  /** The school's rules; the first read seeds: class teacher → coordinator → vice principal → principal. */
  private async settings(c: PoolClient): Promise<Settings> {
    const made = await c.query(
      `INSERT INTO gate_pass_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
    );
    if (made.rowCount)
      await c.query(
        `INSERT INTO gate_pass_levels (school_id, audience, seq, label, kind, role_code, designation)
         SELECT app.current_school_id(), x.audience, x.seq, x.label, x.kind, x.role_code, x.designation FROM (VALUES
           ('student', 1, 'Class teacher', 'class_teacher', NULL, NULL),
           ('student', 2, 'Coordinator', 'role', 'academic_coordinator', NULL),
           ('student', 3, 'Vice Principal', 'designation', NULL, 'Vice Principal'),
           ('student', 4, 'Principal', 'designation', NULL, 'Principal'),
           ('staff', 1, 'Coordinator', 'role', 'academic_coordinator', NULL),
           ('staff', 2, 'Vice Principal', 'designation', NULL, 'Vice Principal'),
           ('staff', 3, 'Principal', 'designation', NULL, 'Principal')
         ) AS x(audience, seq, label, kind, role_code, designation)
          WHERE NOT EXISTS (SELECT 1 FROM gate_pass_levels)`,
      );
    const r = await c.query<Row>(
      `SELECT student_mode, student_need, staff_mode, staff_need, handover_otp, notify_email FROM gate_pass_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0]!;
    return {
      studentMode: x.student_mode as Settings['studentMode'],
      studentNeed: Number(x.student_need),
      staffMode: x.staff_mode as Settings['staffMode'],
      staffNeed: Number(x.staff_need),
      handoverOtp: Boolean(x.handover_otp),
      notifyEmail: Boolean(x.notify_email),
    };
  }

  private async levels(c: PoolClient, audience?: Audience): Promise<Level[]> {
    const r = await c.query<Row>(
      `SELECT l.id::text, l.audience, l.seq, l.label, l.kind, l.role_code, l.designation, l.employee_id::text, e.display_name AS employee_name, l.active
         FROM gate_pass_levels l LEFT JOIN employees e ON e.id = l.employee_id
        WHERE ($1::text IS NULL OR l.audience = $1) ORDER BY l.audience, l.seq, l.id`,
      [audience ?? null],
    );
    return r.rows.map((x) => ({
      id: String(x.id),
      audience: x.audience as Audience,
      seq: Number(x.seq),
      label: String(x.label),
      kind: x.kind as Level['kind'],
      roleCode: text(x.role_code),
      designation: text(x.designation),
      employeeId: text(x.employee_id),
      employeeName: text(x.employee_name),
      active: Boolean(x.active),
    }));
  }

  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const settings = await this.settings(c);
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND code NOT IN ('parent', 'student')
          ORDER BY name`,
      );
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || designation, '') AS name FROM employees
          WHERE status = 'active' AND deleted_at IS NULL AND user_id IS NOT NULL ORDER BY display_name LIMIT 500`,
      );
      const designations = await c.query<{ d: string }>(
        `SELECT DISTINCT btrim(designation) AS d FROM employees WHERE designation IS NOT NULL AND btrim(designation) <> '' AND deleted_at IS NULL ORDER BY 1 LIMIT 200`,
      );
      return {
        settings,
        levels: await this.levels(c),
        roles: roles.rows,
        staff: staff.rows,
        designations: designations.rows.map((x) => x.d),
      };
    });
  }

  async saveSetup(ctx: RequestContext, dto: GatePassSetupDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      for (const audience of ['student', 'staff'] as const) {
        const active = dto.levels.filter((l) => l.audience === audience && l.active).length;
        if (!active)
          throw new DomainError(
            'validation-failed',
            `Keep at least one approval level for ${audience === 'student' ? 'pupil' : 'staff'} passes`,
            { status: 400 },
          );
      }
      await c.query(
        `UPDATE gate_pass_settings SET student_mode = $1, student_need = $2, staff_mode = $3, staff_need = $4, handover_otp = $5,
                notify_email = $6, updated_at = now(), updated_by = app.current_user_id() WHERE school_id = app.current_school_id()`,
        [
          dto.studentMode,
          dto.studentNeed,
          dto.staffMode,
          dto.staffNeed,
          dto.handoverOtp,
          dto.notifyEmail,
        ],
      );
      // passes already asked keep the levels they were given; the new levels apply from the next request
      await c.query(`DELETE FROM gate_pass_levels`);
      const seq = { student: 0, staff: 0 };
      for (const l of dto.levels) {
        seq[l.audience] += 1;
        await c.query(
          `INSERT INTO gate_pass_levels (school_id, audience, seq, label, kind, role_code, designation, employee_id, active)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            l.audience,
            seq[l.audience],
            l.label,
            l.kind,
            l.kind === 'role' ? l.roleCode : null,
            l.kind === 'designation' ? l.designation : null,
            l.kind === 'employee' ? l.employeeId : null,
            l.active,
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'engagement.gate_pass_setup.update',
        entityType: 'gate_pass_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
    });
    return this.setup(ctx);
  }

  // ---- approvals ------------------------------------------------------------------------------------
  /** The users who hold one level for one pass. */
  private async approversOf(c: PoolClient, l: Level, studentId: string | null): Promise<string[]> {
    if (l.kind === 'class_teacher') {
      if (!studentId) return [];
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT e.user_id::text AS id FROM enrolments en
           JOIN teacher_assignments ta ON ta.class_section_id = en.class_section_id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
           JOIN employees e ON e.id = ta.employee_id AND e.deleted_at IS NULL AND e.user_id IS NOT NULL
          WHERE en.student_id = $1 AND en.status = 'active' AND en.academic_year_id = (
            SELECT max(x.academic_year_id) FROM enrolments x WHERE x.student_id = $1 AND x.status = 'active')`,
        [studentId],
      );
      return r.rows.map((x) => x.id);
    }
    if (l.kind === 'role') {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = app.current_school_id() AND r.code = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
        [l.roleCode],
      );
      return r.rows.map((x) => x.id);
    }
    if (l.kind === 'designation') {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT user_id::text AS id FROM employees
          WHERE lower(btrim(designation)) = lower(btrim($1)) AND user_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
        [l.designation],
      );
      return r.rows.map((x) => x.id);
    }
    const r = await c.query<{ id: string }>(
      `SELECT user_id::text AS id FROM employees WHERE id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL`,
      [l.employeeId],
    );
    return r.rows.map((x) => x.id);
  }

  /**
   * The approval rows of a new pass. One after another: the first level that someone holds may act, the
   * rest wait their turn. Any N: every level may act at once and the pass is approved when N have. A
   * level nobody holds (or that only the requester holds) is skipped and shown as such.
   */
  private async startApprovals(c: PoolClient, id: string): Promise<void> {
    const s = await this.settings(c);
    const p = await this.find(c, id);
    const mode = p.audience === 'student' ? s.studentMode : s.staffMode;
    const need = p.audience === 'student' ? s.studentNeed : s.staffNeed;
    const rows: Array<{ label: string; users: string[] }> = [];
    for (const l of (await this.levels(c, p.audience)).filter((x) => x.active)) {
      const users = (await this.approversOf(c, l, p.studentId)).filter(
        (u) => u !== p.requestedById || p.audience === 'student',
      );
      rows.push({ label: l.label, users });
    }
    if (!rows.some((r) => r.users.length)) {
      // nobody holds any level: the school admins decide, so a request is never stuck
      const admins = await c.query<{ id: string }>(
        `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = app.current_school_id() AND r.code = 'school_admin' AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
      );
      rows.push({ label: 'School admin', users: admins.rows.map((x) => x.id) });
    }
    const holders = rows.filter((r) => r.users.length).length;
    let opened = false;
    let seq = 0;
    for (const r of rows) {
      seq += 1;
      const status = !r.users.length
        ? 'skipped'
        : mode === 'any' || !opened
          ? 'pending'
          : 'waiting';
      if (status === 'pending') opened = true;
      await c.query(
        `INSERT INTO gate_pass_approvals (school_id, pass_id, seq, label, approver_user_ids, status, note)
         VALUES (app.current_school_id(), $1, $2, $3, $4::bigint[], $5, $6)`,
        [
          id,
          seq,
          r.label,
          r.users,
          status,
          status === 'skipped' ? 'Nobody holds this level' : null,
        ],
      );
    }
    await c.query(`UPDATE gate_passes SET approval_mode = $2, approval_need = $3 WHERE id = $1`, [
      id,
      mode,
      mode === 'any' ? Math.max(1, Math.min(need, holders)) : Math.max(1, holders),
    ]);
    if (!holders) return this.finish(c, id, 'approved', 'No approver is set up');
    await this.tellApprovers(c, id);
  }

  /** A mail to everyone who may act on the pass now. */
  private async tellApprovers(c: PoolClient, id: string): Promise<void> {
    const s = await this.settings(c);
    if (!s.notifyEmail) return;
    const p = await this.find(c, id);
    const to = await c.query<{ email: string; label: string }>(
      `SELECT DISTINCT COALESCE(e.email::text, u.email::text) AS email, a.label
         FROM gate_pass_approvals a CROSS JOIN LATERAL unnest(a.approver_user_ids) AS x(uid)
         JOIN users u ON u.id = x.uid LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
        WHERE a.pass_id = $1 AND a.status = 'pending' AND a.acted_at IS NULL AND COALESCE(e.email::text, u.email::text) IS NOT NULL`,
      [id],
    );
    for (const r of to.rows)
      await this.mail(c, r.email, `Gate pass to approve: ${whoOfPass(p)}`, {
        title: 'A gate pass is waiting for your approval',
        colour: '#B26A00',
        intro: `You approve as ${r.label}. Open Gate passes → To approve in the ERP or the teacher app.`,
        rows: this.mailRows(p),
        pass: id,
      });
  }

  private mailRows(p: PassRow): Array<[string, string | null]> {
    return [
      ['Pass', `${KIND_LABEL[p.kind] ?? p.kind} · ${p.number}`],
      [p.audience === 'student' ? 'Student' : 'Employee', whoOfPass(p)],
      ['Date', `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
      ['Back by', p.returnBy ? ist(p.returnBy) : null],
      [
        'Collected by',
        p.escortName ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}` : null,
      ],
      ['Going to', p.destination],
      ['Reason', p.reason],
      ['Carrying', p.items ? `${String(p.items)} item(s)` : null],
    ];
  }

  private async mail(
    c: PoolClient,
    to: string,
    subject: string,
    m: {
      title: string;
      colour: string;
      intro: string;
      rows: Array<[string, string | null]>;
      pass: string;
      cid?: string | null;
      caption?: string | null;
      files?: Array<{ fileId: string; name: string; contentType: string }>;
    },
  ): Promise<void> {
    await c.query(
      `SELECT app.queue_mail($1, $2,
                app.mail_card_html((SELECT name FROM schools WHERE id = app.current_school_id()), $3, $4, $5, $6::jsonb, $7, $8, NULL),
                $9::jsonb, jsonb_build_object('gatePass', $10::text))`,
      [
        to,
        subject,
        m.title,
        m.colour,
        m.intro,
        JSON.stringify(m.rows),
        m.cid ?? null,
        m.caption ?? null,
        JSON.stringify(m.files ?? []),
        m.pass,
      ],
    );
  }

  /** The people told about a decision: the family (guardians who take notices) or the employee. */
  private async ownersMail(c: PoolClient, p: PassRow): Promise<string[]> {
    const r =
      p.audience === 'student'
        ? await c.query<{ email: string }>(
            `SELECT DISTINCT lower(g.email::text) AS email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
              WHERE sg.student_id = $1 AND sg.receives_notifications AND g.email IS NOT NULL`,
            [p.studentId],
          )
        : await c.query<{ email: string }>(
            `SELECT lower(email::text) AS email FROM employees WHERE id = $1 AND email IS NOT NULL`,
            [p.employeeId],
          );
    return r.rows.map((x) => x.email);
  }

  /** The end of the approval: number, code, QR and card for an approved pass; the owner is told. */
  private async finish(
    c: PoolClient,
    id: string,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ): Promise<void> {
    await c.query(
      `UPDATE gate_pass_approvals SET status = 'skipped', note = COALESCE(note, 'Not needed') WHERE pass_id = $1 AND status IN ('pending', 'waiting')`,
      [id],
    );
    if (outcome === 'approved') {
      const cur = await c.query<{ audience: string; kind: string }>(
        `SELECT audience, kind FROM gate_passes WHERE id = $1`,
        [id],
      );
      const prefix = `${cur.rows[0]!.audience === 'student' ? 'GP' : cur.rows[0]!.kind.toUpperCase()}/`;
      await c.query(
        `SELECT pg_advisory_xact_lock(hashtext('gate_pass_no'), app.current_school_id()::int)`,
      );
      const code = Array.from(
        { length: 10 },
        () => PASS_ALPHABET[randomInt(PASS_ALPHABET.length)],
      ).join('');
      await c.query(
        `UPDATE gate_passes SET state = 'approved', status = 'approved', pass_code = $3, issued_at = now(), issued_by = app.current_user_id(),
                decided_at = now(), decision_note = $4, updated_at = now(),
                pass_no = $2 || to_char(CURRENT_DATE, 'YYYY') || '/' || lpad((
                  SELECT (count(*) + 1)::text FROM gate_passes x WHERE x.pass_no LIKE $2 || to_char(CURRENT_DATE, 'YYYY') || '/%'), 5, '0')
          WHERE id = $1`,
        [id, prefix, code, note],
      );
    } else
      await c.query(
        `UPDATE gate_passes SET state = 'rejected', status = 'rejected', decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, note],
      );
    const p = await this.find(c, id);
    const s = await this.settings(c);
    if (!s.notifyEmail) return;
    const to = await this.ownersMail(c, p);
    if (!to.length) return;
    let files: Array<{ fileId: string; name: string; contentType: string }> = [];
    if (outcome === 'approved') {
      const qr = await this.store(c, id, 'gate-pass-qr.png', 'image/png', await qrPng(p.passCode!));
      const name = `gate-pass-${p.number.replace(/\//g, '-')}.pdf`;
      const card = await this.store(c, id, name, 'application/pdf', await this.cardPdf(c, p));
      await c.query(`UPDATE gate_passes SET qr_file_id = $2, card_file_id = $3 WHERE id = $1`, [
        id,
        qr,
        card,
      ]);
      files = [
        { fileId: qr, name: 'gate-pass-qr.png', contentType: 'image/png' },
        { fileId: card, name, contentType: 'application/pdf' },
      ];
    }
    for (const email of to)
      await this.mail(
        c,
        email,
        outcome === 'approved'
          ? `Gate pass ${p.number} approved: ${whoOfPass(p)}`
          : `Gate pass not approved: ${whoOfPass(p)}`,
        {
          title: outcome === 'approved' ? 'Gate pass approved' : 'Gate pass not approved',
          colour: outcome === 'approved' ? '#1B7F4B' : '#B3261E',
          intro:
            outcome === 'approved'
              ? p.audience === 'student' && p.kind === 'early_leave'
                ? 'The gate pass is approved. The person collecting the child reports to the front desk, where a photo is taken; the gate lets the child out against this pass.'
                : 'The gate pass is approved. Show the QR code below, or the attached card, at the school gate.'
              : `The gate pass was not approved${note ? `: ${note}` : '.'}`,
          rows: this.mailRows(p),
          pass: id,
          cid: outcome === 'approved' ? 'gate-pass-qr.png' : null,
          caption: outcome === 'approved' ? `Pass ${p.passCode ?? ''} · scan at the gate` : null,
          files,
        },
      );
  }

  /** An approver acts on a pass that waits on them. */
  async decide(ctx: RequestContext, id: string, dto: PassDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id, true);
      if (p.state !== 'pending')
        throw new DomainError('conflict', `This pass is already ${p.state.replace('_', ' ')}`, {
          status: 409,
        });
      const mine = await c.query<{ id: string }>(
        `SELECT id::text FROM gate_pass_approvals WHERE pass_id = $1 AND status = 'pending' AND app.current_user_id() = ANY(approver_user_ids)
          ORDER BY seq LIMIT 1`,
        [id],
      );
      if (!mine.rows[0])
        throw new DomainError('forbidden', 'This pass is not waiting for your approval', {
          status: 403,
        });
      await c.query(
        `UPDATE gate_pass_approvals SET status = $2, acted_by = app.current_user_id(), acted_at = now(), note = $3 WHERE id = $1`,
        [mine.rows[0].id, dto.outcome, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `engagement.gate_pass.level_${dto.outcome}`,
        entityType: 'gate_passes',
        entityId: id,
        after: { note: dto.note ?? null },
      });
      if (dto.outcome === 'rejected') await this.finish(c, id, 'rejected', dto.note ?? null);
      else if (p.approvalMode === 'any') {
        const n = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM gate_pass_approvals WHERE pass_id = $1 AND status = 'approved'`,
          [id],
        );
        if ((n.rows[0]?.n ?? 0) >= p.approvalNeed) await this.finish(c, id, 'approved', null);
      } else {
        const next = await c.query<{ id: string }>(
          `UPDATE gate_pass_approvals SET status = 'pending' WHERE id = (
             SELECT id FROM gate_pass_approvals WHERE pass_id = $1 AND status = 'waiting' ORDER BY seq LIMIT 1) RETURNING id::text`,
          [id],
        );
        if (next.rows[0]) await this.tellApprovers(c, id);
        else await this.finish(c, id, 'approved', null);
      }
      return this.detail(c, ctx, id);
    });
  }

  /** The passes that wait on me, and the ones I have decided lately. */
  async inbox(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const open = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${SELECT} WHERE p.state = 'pending' AND EXISTS (SELECT 1 FROM gate_pass_approvals a WHERE a.pass_id = p.id AND a.status = 'pending'
              AND app.current_user_id() = ANY(a.approver_user_ids)) ORDER BY p.on_date, p.at_time NULLS LAST, p.id LIMIT 200`,
      );
      const done = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${SELECT} WHERE EXISTS (SELECT 1 FROM gate_pass_approvals a WHERE a.pass_id = p.id AND a.acted_by = app.current_user_id())
          ORDER BY p.created_at DESC LIMIT 30`,
      );
      return { data: open.rows.map(toRow), decided: done.rows.map(toRow) };
    });
  }

  // ---- reading --------------------------------------------------------------------------------------
  private async find(c: PoolClient, id: string, lock = false): Promise<PassRow> {
    if (lock) await c.query(`SELECT 1 FROM gate_passes WHERE id = $1 FOR UPDATE`, [id]);
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is bound
    const r = await c.query<Row>(`${SELECT} WHERE p.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Gate pass not found', { status: 404 });
    return toRow(r.rows[0]);
  }

  /** Everything about one pass: the approval trail, the items and which photos exist. */
  private async detail(c: PoolClient, ctx: RequestContext, id: string) {
    const p = await this.find(c, id);
    const trail = await c.query<Row>(
      `SELECT a.seq, a.label, a.status, a.acted_at, a.note, u.display_name AS acted_by,
              (SELECT string_agg(x.display_name, ', ' ORDER BY x.display_name) FROM users x WHERE x.id = ANY(a.approver_user_ids)) AS approvers,
              app.current_user_id() = ANY(a.approver_user_ids) AS mine
         FROM gate_pass_approvals a LEFT JOIN users u ON u.id = a.acted_by WHERE a.pass_id = $1 ORDER BY a.seq`,
      [id],
    );
    const items = await c.query<Row>(
      `SELECT id::text, name, qty, serial_no, returnable, returned_qty, returned_at FROM gate_pass_items WHERE pass_id = $1 ORDER BY id`,
      [id],
    );
    const snap = p.studentId
      ? await readStudentProfile(c, p.studentId, { showSensitive: false })
      : null;
    const guardians = p.studentId
      ? await c.query<Row>(
          `SELECT sg.relation::text AS relation, g.display_name AS name, right(g.mobile, 4) AS mobile_end
             FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = $1 ORDER BY sg.is_primary DESC NULLS LAST, g.id`,
          [p.studentId],
        )
      : null;
    const code = p.passCode;
    return {
      ...p,
      who: whoOfPass(p),
      kindLabel: KIND_LABEL[p.kind] ?? p.kind,
      approvals: trail.rows.map((x) => ({
        seq: Number(x.seq),
        label: String(x.label),
        status: String(x.status),
        approvers: text(x.approvers),
        actedBy: text(x.acted_by),
        actedAt: iso(x.acted_at),
        note: text(x.note),
        mine: Boolean(x.mine),
      })),
      /** I may approve or reject now. */
      canDecide:
        p.state === 'pending' && trail.rows.some((x) => x.status === 'pending' && Boolean(x.mine)),
      itemList: items.rows.map((x) => ({
        id: String(x.id),
        name: String(x.name),
        qty: Number(x.qty),
        serialNo: text(x.serial_no),
        returnable: Boolean(x.returnable),
        returnedQty: Number(x.returned_qty),
        returnedAt: iso(x.returned_at),
      })),
      /** Photos on the pupil's record, to compare with the person in front of the desk. */
      photos: {
        student: Boolean(snap?.photos.student),
        father: Boolean(snap?.photos.father),
        mother: Boolean(snap?.photos.mother),
        guardian: Boolean(snap?.photos.guardian),
        collector: p.hasPhoto,
      },
      guardians: (guardians?.rows ?? []).map((x) => ({
        relation: String(x.relation),
        name: String(x.name),
        mobileEnd: text(x.mobile_end),
      })),
      /** An outsider collects: the front desk needs the one-time code sent to the parent. */
      otpNeeded:
        p.audience === 'student' &&
        p.escortKind === 'other' &&
        (await this.settings(c)).handoverOtp,
      qr: code
        ? await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        : null,
      barcode: code
        ? bwipjs.toSVG({
            bcid: 'code128',
            text: code,
            height: 10,
            includetext: false,
            paddingwidth: 2,
          })
        : null,
      school:
        (
          await c.query<{ name: string }>(
            `SELECT name FROM schools WHERE id = app.current_school_id()`,
          )
        ).rows[0]?.name ?? '',
    };
  }

  /** Staff who work the passes, an approver of the pass, or the employee it belongs to. */
  private async assertMaySee(c: PoolClient, ctx: RequestContext, p: PassRow): Promise<void> {
    if ([GATE.view, GATE.handover, GATE.gate, GATE.issue].some((x) => this.may(ctx, x))) return;
    const r = await c.query(
      `SELECT 1 FROM gate_pass_approvals WHERE pass_id = $1 AND app.current_user_id() = ANY(approver_user_ids)
       UNION ALL SELECT 1 FROM employees WHERE id = $2 AND user_id = app.current_user_id()`,
      [p.id, p.employeeId],
    );
    if (!r.rowCount) throw new DomainError('not-found', 'Gate pass not found', { status: 404 });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMaySee(c, ctx, await this.find(c, id));
      return this.detail(c, ctx, id);
    });
  }

  private where(q: ExportPassesDto, params: unknown[]): string {
    const where = [STAGE_SQL[q.stage] ?? 'true'];
    if (q.audience) {
      params.push(q.audience);
      where.push(`p.audience = $${String(params.length)}`);
    }
    if (q.from) {
      params.push(q.from);
      where.push(`p.on_date >= $${String(params.length)}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`p.on_date <= $${String(params.length)}::date`);
    }
    if (q.q) {
      params.push(q.q);
      where.push(
        `concat_ws(' ', p.pass_no, p.pass_code, s.display_name, s.admission_no, e.display_name, e.employee_code, p.escort_name, p.reason)
           ILIKE '%' || $${String(params.length)} || '%'`,
      );
    }
    return where.join(' AND ');
  }

  /** The front-desk register with the tab counts; every row carries where its approval stands. */
  async list(ctx: RequestContext, q: ListPassesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const params: unknown[] = [];
      const w = this.where(q, params);
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- FROM is a constant; w holds fixed fragments; values bound
        `SELECT count(*)::int AS n ${FROM} WHERE ${w}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; values bound
        `${SELECT} WHERE ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      return {
        data: r.rows.map(toRow),
        page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
        counts: await this.counts(c),
      };
    });
  }

  private async counts(c: PoolClient) {
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- the stage fragments are constants
      `SELECT count(*) FILTER (WHERE ${STAGE_SQL.approval})::int AS approval, count(*) FILTER (WHERE ${STAGE_SQL.handover})::int AS handover,
              count(*) FILTER (WHERE ${STAGE_SQL.gate})::int AS gate, count(*) FILTER (WHERE ${STAGE_SQL.out})::int AS out,
              count(*) FILTER (WHERE ${STAGE_SQL.today})::int AS today FROM gate_passes p`,
    );
    const x = r.rows[0] ?? {};
    return {
      approval: Number(x.approval ?? 0),
      handover: Number(x.handover ?? 0),
      gate: Number(x.gate ?? 0),
      out: Number(x.out ?? 0),
      today: Number(x.today ?? 0),
    };
  }

  /** What the common dashboard shows about gate passes. */
  async dashboard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const more = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- TODAY is a constant; values bound
        `SELECT count(*) FILTER (WHERE p.state = 'out' AND p.kind = 'rgp' AND p.return_by < now())::int AS overdue,
                count(*) FILTER (WHERE p.on_date = ${TODAY} AND p.audience = 'student')::int AS students_today,
                count(*) FILTER (WHERE p.on_date = ${TODAY} AND p.audience = 'staff')::int AS staff_today,
                count(*) FILTER (WHERE p.on_date = ${TODAY} AND p.state = 'rejected')::int AS rejected_today,
                (SELECT COALESCE(sum(i.qty - i.returned_qty), 0)::int FROM gate_pass_items i JOIN gate_passes g ON g.id = i.pass_id
                  WHERE i.returnable AND i.returned_qty < i.qty AND g.state IN ('out', 'returned')) AS items_due
           FROM gate_passes p`,
      );
      const out = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${SELECT} WHERE p.state = 'out' AND p.kind = 'rgp' ORDER BY p.return_by NULLS LAST LIMIT 20`,
      );
      const x = more.rows[0] ?? {};
      return {
        counts: await this.counts(c),
        overdue: Number(x.overdue ?? 0),
        studentsToday: Number(x.students_today ?? 0),
        staffToday: Number(x.staff_today ?? 0),
        rejectedToday: Number(x.rejected_today ?? 0),
        itemsDue: Number(x.items_due ?? 0),
        outNow: out.rows.map(toRow),
      };
    });
  }

  async excel(ctx: RequestContext, q: ExportPassesDto) {
    const rows = await this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const w = this.where(q, params);
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w holds fixed fragments; values bound
        `${SELECT} WHERE ${w} ORDER BY p.created_at DESC, p.id DESC LIMIT ${String(EXPORT_MAX)}`,
        params,
      );
      return r.rows.map(toRow);
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Gate passes');
    ws.addRow([`Gate passes · ${String(rows.length)} row(s)`]).font = { bold: true };
    ws.addRow([
      'Pass no.',
      'Type',
      'For',
      'Name',
      'Admission no. / Emp. code',
      'Class / Designation',
      'Date',
      'Time',
      'Back by',
      'Collected by',
      'Reason',
      'Going to',
      'Items',
      'Items not back',
      'Status',
      'Approvals',
      'Handed over',
      'Out',
      'In',
      'Requested by',
    ]).font = { bold: true };
    for (const p of rows)
      ws.addRow([
        p.number,
        KIND_LABEL[p.kind] ?? p.kind,
        p.audience === 'student' ? 'Student' : 'Staff',
        p.student ?? p.employee ?? '',
        p.admissionNo ?? p.employeeCode ?? '',
        p.section ?? p.designation ?? '',
        p.onDate,
        p.atTime ?? '',
        ist(p.returnBy),
        p.escortName ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}` : '',
        p.reason,
        p.destination ?? '',
        p.items || '',
        p.itemsDue || '',
        p.stage,
        `${String(p.approvedLevels)} of ${String(p.approvalMode === 'any' ? p.approvalNeed : p.levels)}`,
        ist(p.handoverAt),
        ist(p.outAt),
        ist(p.inAt),
        p.requestedBy ?? '',
      ]);
    [16, 20, 9, 24, 18, 16, 12, 8, 18, 24, 32, 22, 7, 12, 30, 11, 18, 18, 18, 20].forEach(
      (w, i) => {
        ws.getColumn(i + 1).width = w;
      },
    );
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    const out = await wb.xlsx.writeBuffer();
    return {
      bytes: Buffer.from(out as ArrayBuffer),
      filename: `gate-passes-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  // ---- asking for a pass ----------------------------------------------------------------------------
  /** The guardians on a pupil's record, for "who takes the child". */
  private async guardiansOf(c: PoolClient, studentId: string) {
    const r = await c.query<Row>(
      `SELECT sg.relation::text AS relation, g.display_name AS name, g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 ORDER BY sg.is_primary DESC NULLS LAST, g.id`,
      [studentId],
    );
    return r.rows.map((x) => ({
      relation: String(x.relation),
      name: String(x.name),
      mobile: text(x.mobile),
    }));
  }

  private async createStudent(
    c: PoolClient,
    ctx: RequestContext,
    dto: StudentPassDto,
    source: 'parent' | 'front_desk',
  ): Promise<string> {
    const st = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
      dto.studentId,
    ]);
    if (!st.rowCount) throw new DomainError('not-found', 'Student not found', { status: 404 });
    let name = dto.escortName ?? null;
    let relation = dto.escortRelation ?? null;
    let mobile = dto.escortMobile ?? null;
    if (dto.escortKind && dto.escortKind !== 'other') {
      const g = (await this.guardiansOf(c, dto.studentId)).find(
        (x) => x.relation === dto.escortKind,
      );
      if (!g)
        throw new DomainError(
          'gate_pass.no_guardian',
          `No ${dto.escortKind} is on the school's record; choose "someone else" and give the name`,
          { status: 400 },
        );
      name = g.name;
      relation = dto.escortKind;
      mobile = g.mobile;
    }
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- TODAY is a constant; values bound
      `INSERT INTO gate_passes (school_id, audience, student_id, kind, source, on_date, at_time, reason, escort_kind, escort_name, escort_relation,
                                escort_mobile, requested_by, request_id)
       VALUES (app.current_school_id(), 'student', $1, $2, $3, COALESCE($4::date, ${TODAY}), $5::time, $6, $7, $8, $9, $10, app.current_user_id(),
               app.current_request_id()) RETURNING id::text`,
      [
        dto.studentId,
        dto.kind,
        source,
        dto.onDate ?? null,
        dto.atTime ?? null,
        dto.reason,
        dto.escortKind ?? null,
        name,
        relation,
        mobile,
      ],
    );
    const id = r.rows[0]!.id;
    await this.startApprovals(c, id);
    await this.audit.stage(ctx, c, {
      action: 'engagement.gate_pass.request',
      entityType: 'gate_passes',
      entityId: id,
      after: { ...dto, source },
    });
    return id;
  }

  private async family(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, GATE.family);
    if (v.kind !== 'family')
      throw new DomainError('forbidden', 'Only a parent or student can do this here', {
        status: 403,
      });
    return v;
  }

  /** What the family's form needs: each child with the guardians on record. */
  async familyOptions(ctx: RequestContext) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const data = [];
      for (const s of v.students)
        data.push({
          id: s.id,
          name: s.name,
          guardians: (await this.guardiansOf(c, s.id)).map((g) => ({
            relation: g.relation,
            name: g.name,
          })),
        });
      return { data };
    });
  }

  async familyApply(ctx: RequestContext, dto: StudentPassDto) {
    const v = await this.family(ctx);
    if (!v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.detail(c, ctx, await this.createStudent(c, ctx, dto, 'parent')),
    );
  }

  /** The legacy mobile app's request (compat): an escort typed there is "someone else". */
  async legacyCreate(
    ctx: RequestContext,
    dto: {
      studentId: string;
      kind: 'early_leave' | 'late_arrival';
      onDate?: string;
      atTime?: string;
      reason: string;
      escortName?: string;
      escortRelation?: string;
      escortMobile?: string;
    },
    byFamily: boolean,
  ): Promise<{ id: string }> {
    if (byFamily) {
      const v = await this.family(ctx);
      if (!v.students.some((s) => s.id === dto.studentId))
        throw new DomainError('not-found', 'Student not found', { status: 404 });
    }
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      id: await this.createStudent(
        c,
        ctx,
        { ...dto, escortKind: dto.escortName ? 'other' : undefined } as StudentPassDto,
        byFamily ? 'parent' : 'front_desk',
      ),
    }));
  }

  /** The front desk makes a pass for a parent who walked in; it is approved like any other. */
  async deskCreate(ctx: RequestContext, dto: StudentPassDto) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.detail(c, ctx, await this.createStudent(c, ctx, dto, 'front_desk')),
    );
  }

  /** Pupils by name or admission number for a pass made at the desk. */
  async deskStudents(ctx: RequestContext, q: string) {
    const term = q.trim();
    if (term.length < 2) return { data: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no,
                (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE en.student_id = s.id AND en.status = 'active' ORDER BY en.academic_year_id DESC LIMIT 1) AS section
           FROM students s
          WHERE s.deleted_at IS NULL AND (s.admission_no ILIKE $1 || '%' OR s.display_name ILIKE '%' || $1 || '%')
          ORDER BY (lower(s.admission_no) = lower($1)) DESC, s.display_name LIMIT 12`,
        [term],
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          name: String(x.name),
          admissionNo: String(x.admission_no),
          section: text(x.section),
        })),
      };
    });
  }

  /** For the front-desk form: the pupil with the guardians on record. */
  async deskGuardians(ctx: RequestContext, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      data: (await this.guardiansOf(c, studentId)).map((g) => ({
        relation: g.relation,
        name: g.name,
        mobileEnd: g.mobile ? g.mobile.slice(-4) : null,
      })),
    }));
  }

  private myWhere(q: MyPassesDto, params: unknown[], where: string[]): string {
    if (q.state === 'open')
      where.push(
        `p.state IN ('pending', 'approved', 'handed_over') OR (p.state = 'out' AND p.kind = 'rgp')`,
      );
    if (q.state === 'past')
      where.push(
        `(p.state IN ('returned', 'rejected', 'cancelled') OR (p.state = 'out' AND p.kind <> 'rgp'))`,
      );
    if (q.from) {
      params.push(q.from);
      where.push(`p.on_date >= $${String(params.length)}::date`);
    }
    if (q.to) {
      params.push(q.to);
      where.push(`p.on_date <= $${String(params.length)}::date`);
    }
    if (q.q) {
      params.push(q.q);
      where.push(
        `concat_ws(' ', p.pass_no, p.reason, p.destination, p.escort_name, s.display_name) ILIKE '%' || $${String(params.length)} || '%'`,
      );
    }
    return where.map((x) => `(${x})`).join(' AND ');
  }

  private async page(c: PoolClient, w: string, params: unknown[], q: MyPassesDto) {
    const total = await c.query<{ n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- FROM is a constant; w holds fixed fragments; values bound
      `SELECT count(*)::int AS n ${FROM} WHERE ${w}`,
      params,
    );
    // between two days (the calendar) in date order; otherwise latest first
    const order =
      q.from || q.to ? 'p.on_date, p.at_time NULLS LAST, p.id' : 'p.created_at DESC, p.id DESC';
    params.push(q.size, (q.page - 1) * q.size);
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; w and order hold fixed fragments; values bound
      `${SELECT} WHERE ${w} ORDER BY ${order} LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
      params,
    );
    return {
      data: r.rows.map(toRow),
      page: { number: q.page, size: q.size, total: total.rows[0]?.n ?? 0 },
    };
  }

  async familyList(ctx: RequestContext, q: MyPassesDto) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [v.students.map((s) => s.id)];
      const where = [`p.student_id = ANY($1::bigint[])`];
      if (q.studentId) {
        params.push(q.studentId);
        where.push(`p.student_id = $${String(params.length)}`);
      }
      return this.page(c, this.myWhere(q, params, where), params, q);
    });
  }

  private async familyPass(
    c: PoolClient,
    v: { students: Array<{ id: string }> },
    id: string,
  ): Promise<PassRow> {
    const p = await this.find(c, id);
    if (!p.studentId || !v.students.some((s) => s.id === p.studentId))
      throw new DomainError('not-found', 'Gate pass not found', { status: 404 });
    return p;
  }

  async familyGet(ctx: RequestContext, id: string) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.familyPass(c, v, id);
      const d = await this.detail(c, ctx, id);
      // the family sees who decided, not the internal list of who could have
      return {
        ...d,
        approvals: d.approvals.map((a) => ({ ...a, approvers: null })),
        guardians: [],
        escortMobile: null,
      };
    });
  }

  private async cancelWith(c: PoolClient, ctx: RequestContext, p: PassRow, reason: string | null) {
    if (!['pending', 'approved'].includes(p.state))
      throw new DomainError('conflict', 'This pass can no longer be cancelled', { status: 409 });
    await c.query(
      `UPDATE gate_passes SET state = 'cancelled', status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
      [p.id, reason],
    );
    await c.query(
      `UPDATE gate_pass_approvals SET status = 'skipped', note = 'Cancelled' WHERE pass_id = $1 AND status IN ('pending', 'waiting')`,
      [p.id],
    );
    await this.audit.stage(ctx, c, {
      action: 'engagement.gate_pass.cancel',
      entityType: 'gate_passes',
      entityId: p.id,
      after: { reason },
    });
  }

  async familyCancel(ctx: RequestContext, id: string, dto: PassCancelDto) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cancelWith(c, ctx, await this.familyPass(c, v, id), dto.reason ?? null);
      return { id };
    });
  }

  // ---- staff passes ---------------------------------------------------------------------------------
  private async myEmployee(c: PoolClient): Promise<string> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    if (!r.rows[0])
      throw new DomainError('forbidden', 'Your sign-in is not linked to an employee record', {
        status: 403,
      });
    return r.rows[0].id;
  }

  async staffApply(ctx: RequestContext, dto: StaffPassDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const employee = await this.myEmployee(c);
      const r = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- TODAY is a constant; values bound
        `INSERT INTO gate_passes (school_id, audience, employee_id, kind, source, on_date, at_time, return_by, reason, destination, requested_by, request_id)
         VALUES (app.current_school_id(), 'staff', $1, $2, 'employee', COALESCE($3::date, ${TODAY}), $4::time,
                 CASE WHEN $5::text IS NULL THEN NULL ELSE (COALESCE($3::date, ${TODAY})::text || ' ' || $5 || ':00+05:30')::timestamptz END,
                 $6, $7, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [
          employee,
          dto.category,
          dto.onDate ?? null,
          dto.atTime,
          dto.returnTime ?? null,
          dto.reason,
          dto.destination ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      for (const i of dto.items)
        await c.query(
          `INSERT INTO gate_pass_items (school_id, pass_id, name, qty, serial_no, returnable) VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [id, i.name, i.qty, i.serialNo ?? null, i.returnable],
        );
      await this.startApprovals(c, id);
      await this.audit.stage(ctx, c, {
        action: 'engagement.gate_pass.request',
        entityType: 'gate_passes',
        entityId: id,
        after: dto,
      });
      return this.detail(c, ctx, id);
    });
  }

  async staffList(ctx: RequestContext, q: MyPassesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const params: unknown[] = [];
      const where = [
        `p.employee_id = (SELECT me.id FROM employees me WHERE me.user_id = app.current_user_id() AND me.deleted_at IS NULL LIMIT 1)`,
      ];
      return this.page(c, this.myWhere(q, params, where), params, q);
    });
  }

  async staffCancel(ctx: RequestContext, id: string, dto: PassCancelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id);
      if (!p.employeeId || p.employeeId !== (await this.myEmployee(c)))
        throw new DomainError('not-found', 'Gate pass not found', { status: 404 });
      await this.cancelWith(c, ctx, p, dto.reason ?? null);
      return { id };
    });
  }

  // ---- hand-over at the front desk ------------------------------------------------------------------
  private otpHash(id: string, code: string): string {
    return createHash('sha256')
      .update(`${this.env.APPLICANT_JWT_SECRET}:gate:${id}:${code}`)
      .digest('hex');
  }

  /** A one-time code to the parent before the child goes with someone who is not on the record. */
  async sendOtp(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id, true);
      if (p.state !== 'approved' || p.audience !== 'student')
        throw new DomainError('conflict', 'This pass is not waiting for hand-over', {
          status: 409,
        });
      // the parent who asked, else the guardian who takes the school's notices
      const g = await c.query<{ mobile: string }>(
        `SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = $1 AND g.mobile ~ '^[6-9][0-9]{9}$'
          ORDER BY (g.user_id = $2::bigint) DESC NULLS LAST, sg.receives_notifications DESC, sg.is_primary DESC NULLS LAST, g.id LIMIT 1`,
        [p.studentId, p.requestedById],
      );
      if (!g.rows[0])
        throw new DomainError(
          'gate_pass.no_parent_mobile',
          'No parent mobile is on the record to send the code to',
          { status: 409 },
        );
      const code = String(randomInt(100000, 1000000));
      await c.query(
        `UPDATE gate_passes SET otp_hash = $2, otp_expires_at = now() + make_interval(mins => $3), otp_tries = 0, otp_verified_at = NULL WHERE id = $1`,
        [id, this.otpHash(id, code), OTP_MINUTES],
      );
      const sent = await c.query<{ n: number }>(`SELECT app.public_otp_send($1, $2, $3) AS n`, [
        g.rows[0].mobile,
        code,
        OTP_MINUTES,
      ]);
      const out: { sent: boolean; mobileEnd: string; minutes: number; devCode?: string } = {
        sent: Number(sent.rows[0]?.n ?? 0) > 0,
        mobileEnd: g.rows[0].mobile.slice(-4),
        minutes: OTP_MINUTES,
      };
      if (this.env.AUTH_DEV_BYPASS) out.devCode = code;
      return out;
    });
  }

  private photoOf(dataUrl: string): { contentType: string; bytes: Buffer } {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m)
      throw new DomainError(
        'validation-failed',
        'The photo must be a small JPEG, PNG or WebP image',
        {
          status: 400,
        },
      );
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length < 500 || bytes.length > 300_000)
      throw new DomainError('validation-failed', 'The photo is too small or too large', {
        status: 400,
      });
    return { contentType: m[1]!, bytes };
  }

  /** The front desk gives the child to the collector: a live photo, and the parent's code for an outsider. */
  async handover(ctx: RequestContext, id: string, dto: HandoverDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id, true);
      if (p.state !== 'approved' || p.audience !== 'student' || p.kind !== 'early_leave')
        throw new DomainError('conflict', 'This pass is not waiting for hand-over', {
          status: 409,
        });
      const today = await c.query<{ ok: boolean }>(
        `SELECT $1::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AS ok`,
        [p.onDate],
      );
      if (!today.rows[0]?.ok)
        throw new DomainError('gate_pass.not_today', `This pass is for ${p.onDate}, not today`, {
          status: 409,
        });
      const s = await this.settings(c);
      if (p.escortKind === 'other' && s.handoverOtp) {
        const cur = await c.query<{ otp_hash: string | null; live: boolean; otp_tries: number }>(
          `SELECT otp_hash, otp_expires_at > now() AS live, otp_tries FROM gate_passes WHERE id = $1`,
          [id],
        );
        const o = cur.rows[0]!;
        if (!dto.otp || !o.otp_hash || !o.live)
          throw new DomainError(
            'gate_pass.otp_needed',
            'Send the one-time code to the parent and enter it here',
            { status: 409 },
          );
        if (o.otp_tries >= 5)
          throw new DomainError('gate_pass.otp_locked', 'Too many wrong codes; send a new one', {
            status: 409,
          });
        if (o.otp_hash !== this.otpHash(id, dto.otp)) {
          // counted outside this transaction's rollback would need its own; the next send resets it
          await c.query(`UPDATE gate_passes SET otp_tries = otp_tries + 1 WHERE id = $1`, [id]);
          return { ok: false as const, error: 'The code is not right' };
        }
        await c.query(
          `UPDATE gate_passes SET otp_verified_at = now(), otp_hash = NULL WHERE id = $1`,
          [id],
        );
      }
      const photo = this.photoOf(dto.photo);
      await c.query(
        `INSERT INTO gate_pass_photos (pass_id, school_id, content_type, bytes, taken_by) VALUES ($1, app.current_school_id(), $2, $3, app.current_user_id())
         ON CONFLICT (pass_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, taken_by = EXCLUDED.taken_by, taken_at = now()`,
        [id, photo.contentType, photo.bytes],
      );
      await c.query(
        `UPDATE gate_passes SET state = 'handed_over', handover_at = now(), handover_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.gate_pass.handover',
        entityType: 'gate_passes',
        entityId: id,
        after: { escort: p.escortName, otp: p.escortKind === 'other' && s.handoverOtp },
      });
      return { ok: true as const, pass: await this.detail(c, ctx, id) };
    });
  }

  // ---- the gate -------------------------------------------------------------------------------------
  /** What the gate keeper works: who may go out now, who is out and due back, late arrivals to let in. */
  async gateBoard(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ready = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT, the stage fragment and TODAY are constants
        `${SELECT} WHERE ${STAGE_SQL.gate} AND p.on_date = ${TODAY} ORDER BY p.at_time NULLS LAST, p.id LIMIT 200`,
      );
      const out = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and the stage fragment are constants
        `${SELECT} WHERE ${STAGE_SQL.out} ORDER BY p.return_by NULLS LAST, p.id LIMIT 200`,
      );
      const gates = await c.query<{ gates: string[] }>(
        `SELECT gates FROM appointment_settings WHERE school_id = app.current_school_id()`,
      );
      return {
        ready: ready.rows.map(toRow),
        out: out.rows.map(toRow),
        gates: gates.rows[0]?.gates ?? ['Main gate'],
      };
    });
  }

  /** By the pass code (scanned QR / barcode) or the pass number. */
  async gateFind(ctx: RequestContext, code: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM gate_passes WHERE upper(pass_code) = upper($1) OR upper(pass_no) = upper($1) ORDER BY id DESC LIMIT 1`,
        [code.trim()],
      );
      if (!r.rows[0])
        throw new DomainError('not-found', 'No gate pass with this code', { status: 404 });
      return this.detail(c, ctx, r.rows[0].id);
    });
  }

  async gateOut(ctx: RequestContext, id: string, dto: GateOutDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id, true);
      const student = p.audience === 'student';
      if (student && p.kind === 'early_leave' && p.state === 'approved')
        throw new DomainError(
          'gate_pass.not_handed_over',
          'The front desk has not handed the child over yet',
          { status: 409 },
        );
      if (student && p.kind === 'late_arrival')
        throw new DomainError('conflict', 'This is a late-arrival pass: let the pupil in', {
          status: 409,
        });
      if (!((student && p.state === 'handed_over') || (!student && p.state === 'approved')))
        throw new DomainError('conflict', `This pass is ${p.stage.toLowerCase()}`, { status: 409 });
      const today = await c.query<{ ok: boolean }>(
        `SELECT $1::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AS ok`,
        [p.onDate],
      );
      if (!today.rows[0]?.ok)
        throw new DomainError('gate_pass.not_today', `This pass is for ${p.onDate}, not today`, {
          status: 409,
        });
      await c.query(
        `UPDATE gate_passes SET state = 'out', out_at = now(), out_by = app.current_user_id(), out_gate = $2, gate_note = $3, updated_at = now() WHERE id = $1`,
        [id, dto.gate ?? null, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.gate_pass.out',
        entityType: 'gate_passes',
        entityId: id,
        after: dto,
      });
      return this.detail(c, ctx, id);
    });
  }

  /** Back in: a returnable staff pass (with the items that came back) or a pupil arriving late. */
  async gateIn(ctx: RequestContext, id: string, dto: GateInDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id, true);
      const late = p.kind === 'late_arrival' && p.state === 'approved';
      if (!late && !(p.kind === 'rgp' && p.state === 'out'))
        throw new DomainError('conflict', `This pass is ${p.stage.toLowerCase()}`, { status: 409 });
      for (const i of dto.items)
        await c.query(
          `UPDATE gate_pass_items SET returned_qty = LEAST(qty, $3), returned_at = now() WHERE id = $2 AND pass_id = $1 AND returnable`,
          [id, i.id, i.returnedQty],
        );
      await c.query(
        `UPDATE gate_passes SET state = 'returned', in_at = now(), in_by = app.current_user_id(),
                gate_note = COALESCE(NULLIF(concat_ws(' · ', gate_note, $2::text), ''), gate_note), updated_at = now() WHERE id = $1`,
        [id, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.gate_pass.in',
        entityType: 'gate_passes',
        entityId: id,
        after: dto,
      });
      return this.detail(c, ctx, id);
    });
  }

  // ---- photos, card, files --------------------------------------------------------------------------
  /** The live photo of the collector. */
  async collectorPhoto(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMaySee(c, ctx, await this.find(c, id));
      const r = await c.query<{ content_type: string; bytes: Buffer }>(
        `SELECT content_type, bytes FROM gate_pass_photos WHERE pass_id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'No photo for this pass', { status: 404 });
      return { contentType: r.rows[0].content_type, bytes: r.rows[0].bytes };
    });
  }

  /** A photo on the pupil's record (student, father, mother, guardian) as a short-lived link. */
  async recordPhoto(ctx: RequestContext, id: string, party: string) {
    if (!['student', 'father', 'mother', 'guardian'].includes(party))
      throw new DomainError('not-found', 'Photo not found', { status: 404 });
    const fileId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id);
      await this.assertMaySee(c, ctx, p);
      if (!p.studentId) return null;
      const snap = await readStudentProfile(c, p.studentId, { showSensitive: false });
      return snap?.photos[party as Party] ?? null;
    });
    if (!fileId) throw new DomainError('not-found', 'Photo not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  private async store(c: PoolClient, id: string, name: string, type: string, bytes: Buffer) {
    const school = await c.query<{ id: string }>(`SELECT app.current_school_id()::text AS id`);
    const key = objectKeyFor(
      school.rows[0]!.id,
      name.split('.').pop()!,
      `gate-pass-${id}-${randomBytes(6).toString('hex')}`,
    );
    await this.storage.write(key, bytes, type);
    const f = await c.query<{ id: string }>(
      `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type, owner_entity_id,
                          classification, storage_driver, status, scanned_at, scan_result, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'gate_passes', $7, 'internal', $8, 'ready', now(), 'generated',
               app.current_user_id(), app.current_user_id())
       RETURNING id::text`,
      [
        this.storage.bucket,
        key,
        type,
        bytes.length,
        createHash('sha256').update(bytes).digest('hex'),
        name,
        id,
        this.storage.name,
      ],
    );
    return f.rows[0]!.id;
  }

  /** The pass as an ID-card size PDF: who, when, who collects, QR and barcode (and the collector's photo). */
  private async cardPdf(c: PoolClient, p: PassRow): Promise<Buffer> {
    const school = await c.query<{ name: string }>(
      `SELECT name FROM schools WHERE id = app.current_school_id()`,
    );
    const photo = await c.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type, bytes FROM gate_pass_photos WHERE pass_id = $1`,
      [p.id],
    );
    const last = await c.query<{ name: string | null }>(
      `SELECT u.display_name AS name FROM gate_pass_approvals a JOIN users u ON u.id = a.acted_by
        WHERE a.pass_id = $1 AND a.status = 'approved' ORDER BY a.acted_at DESC LIMIT 1`,
      [p.id],
    );
    const code = p.passCode ?? p.number;
    return visitorCardPdf({
      school: school.rows[0]!.name,
      kind: p.audience === 'student' ? 'Gate pass' : p.kind.toUpperCase(),
      name: p.student ?? p.employee ?? 'Gate pass',
      rows:
        p.audience === 'student'
          ? [
              ['Class', p.section],
              ['Adm. no.', p.admissionNo],
              [
                p.kind === 'late_arrival' ? 'Arriving' : 'Leaving',
                `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`,
              ],
              [
                'With',
                p.escortName
                  ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}`
                  : null,
              ],
              ['Reason', p.reason],
              ['Approved by', last.rows[0]?.name ?? null],
            ]
          : [
              ['Emp. code', p.employeeCode],
              ['Designation', p.designation],
              ['Out', `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
              [
                'Back by',
                p.returnBy ? ist(p.returnBy) : p.kind === 'nrgp' ? 'Not returning' : null,
              ],
              ['Going to', p.destination],
              ['Purpose', p.reason],
              ['Carrying', p.items ? `${String(p.items)} item(s)` : null],
              ['Approved by', last.rows[0]?.name ?? null],
            ],
      number: p.number,
      code,
      qrText: code,
      photo: photo.rows[0]
        ? { contentType: photo.rows[0].content_type, bytes: photo.rows[0].bytes }
        : null,
    });
  }

  private async cardOut(c: PoolClient, p: PassRow) {
    if (!p.passNo)
      throw new DomainError('conflict', 'The pass has no card until it is approved', {
        status: 409,
      });
    return {
      bytes: await this.cardPdf(c, p),
      filename: `gate-pass-${p.number.replace(/\//g, '-')}.pdf`,
    };
  }

  async cardFor(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await this.find(c, id);
      await this.assertMaySee(c, ctx, p);
      return this.cardOut(c, p);
    });
  }

  async familyCard(ctx: RequestContext, id: string) {
    const v = await this.family(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.cardOut(c, await this.familyPass(c, v, id)),
    );
  }
}
