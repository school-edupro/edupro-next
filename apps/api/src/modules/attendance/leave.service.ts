/* eslint-disable no-restricted-syntax -- the interpolations in this file are constant fragments (SELECT lists, WHERE pieces with numbered placeholders); every value is bound */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { FilesService } from '../files/files.service';
import type {
  LeaveApplyDto,
  LeaveDecideDto,
  LeaveListDto,
  LeaveSetupDto,
} from './attendance-plus.dto';

type Row = Record<string, unknown>;
const TZ = `'Asia/Kolkata'`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;
const APPLY = 'attendance.leave.apply';
const DECIDE = 'attendance.leave.decide';
const SETUP = 'attendance.setup.manage';
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  medical: 'Medical',
  family: 'Family function',
  travel: 'Out of station',
  other: 'Other',
};
const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const LEAVE = `SELECT l.id::text, COALESCE(l.number, 'LV-' || l.id::text) AS number, l.student_id::text, s.display_name AS student, s.admission_no,
       (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
         WHERE en.student_id = s.id AND en.academic_year_id = l.academic_year_id AND en.status = 'active' LIMIT 1) AS section,
       l.leave_type, l.from_date::text, l.to_date::text, l.days, l.reason, l.file_ids, l.chain, l.status, l.applied_at, l.decided_at, l.decision_note,
       l.ended_on::text, COALESCE((SELECT g.display_name FROM guardians g WHERE g.user_id = l.applied_by LIMIT 1), u.display_name) AS applied_by,
       l.applied_by::text AS applied_by_id,
       (SELECT a.label FROM student_leave_approvals a WHERE a.leave_id = l.id AND a.status = 'pending' ORDER BY a.seq LIMIT 1) AS waiting_on
  FROM student_leaves l JOIN students s ON s.id = l.student_id LEFT JOIN users u ON u.id = l.applied_by`;

const toLeave = (x: Row) => ({
  id: String(x.id),
  number: String(x.number),
  studentId: String(x.student_id),
  student: String(x.student),
  admissionNo: text(x.admission_no),
  section: text(x.section),
  leaveType: String(x.leave_type),
  leaveTypeLabel: LEAVE_TYPE_LABEL[String(x.leave_type)] ?? String(x.leave_type),
  fromDate: String(x.from_date),
  toDate: String(x.to_date),
  days: Number(x.days),
  reason: String(x.reason),
  fileIds: ((x.file_ids as unknown[]) ?? []).map(String),
  long: x.chain === 'long',
  status: String(x.status) as 'pending' | 'approved' | 'rejected' | 'cancelled',
  appliedAt: (x.applied_at as Date).toISOString(),
  appliedBy: text(x.applied_by),
  decidedAt: x.decided_at instanceof Date ? x.decided_at.toISOString() : null,
  decisionNote: text(x.decision_note),
  /** The family gave up the rest of the leave: the first day the child is back. */
  endedOn: text(x.ended_on),
  waitingOn: text(x.waiting_on),
});
export type StudentLeave = ReturnType<typeof toLeave>;

/**
 * Student leave (0088): a family applies from the portal; a short leave goes to the class teacher, a long
 * one (more days than the school's limit) on to the coordinator and the principal, level by level. The
 * school sets the limit and the approvers. A long medical leave needs a certificate. An approved leave is
 * what class and bus attendance mark as LV.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly files: FilesService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private assertHolds(ctx: RequestContext, ...any: string[]) {
    if (!any.some((p) => ctx.permissions?.has(p)))
      throw new DomainError('forbidden', 'Student leave is not part of your role', {
        status: 403,
        extra: { permission: any[0] },
      });
  }

  // ---- set-up ---------------------------------------------------------------------------------------
  private async settings(c: PoolClient) {
    await c.query(
      `INSERT INTO leave_settings (school_id) VALUES (app.current_school_id()) ON CONFLICT DO NOTHING`,
    );
    await c.query(
      `INSERT INTO leave_approval_levels (school_id, chain, seq, label, kind, role_code)
       SELECT app.current_school_id(), x.chain, x.seq, x.label, x.kind, x.role_code
         FROM (VALUES ('short', 1, 'Class teacher', 'class_teacher', NULL),
                      ('long', 1, 'Class teacher', 'class_teacher', NULL),
                      ('long', 2, 'Coordinator', 'role', 'academic_coordinator'),
                      ('long', 3, 'Principal', 'role', 'school_admin')) AS x(chain, seq, label, kind, role_code)
        WHERE NOT EXISTS (SELECT 1 FROM leave_approval_levels)`,
    );
    const r = await c.query<{ long_days: number; back_days: number }>(
      `SELECT long_days, back_days FROM leave_settings WHERE school_id = app.current_school_id()`,
    );
    return { longDays: r.rows[0]!.long_days, backDays: r.rows[0]!.back_days };
  }

  private async levels(c: PoolClient, chain?: 'short' | 'long') {
    const r = await c.query<Row>(
      `SELECT l.chain, l.seq, l.label, l.kind, l.role_code, l.employee_id::text, l.active, e.display_name AS employee
         FROM leave_approval_levels l LEFT JOIN employees e ON e.id = l.employee_id
        WHERE ($1::text IS NULL OR l.chain = $1) ORDER BY l.chain DESC, l.seq`,
      [chain ?? null],
    );
    return r.rows.map((x) => ({
      chain: String(x.chain) as 'short' | 'long',
      label: String(x.label),
      kind: String(x.kind) as 'class_teacher' | 'role' | 'employee',
      roleCode: text(x.role_code),
      employeeId: text(x.employee_id),
      employee: text(x.employee),
      active: Boolean(x.active),
    }));
  }

  async setup(ctx: RequestContext) {
    this.assertHolds(ctx, SETUP);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const settings = await this.settings(c);
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'support_engineer', 'erp_support', 'auditor') ORDER BY name`,
      );
      const staff = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name || COALESCE(' · ' || designation, '') || CASE WHEN user_id IS NULL THEN ' · no login' ELSE '' END AS name
           FROM employees WHERE status = 'active' AND deleted_at IS NULL ORDER BY display_name LIMIT 800`,
      );
      return { ...settings, levels: await this.levels(c), roles: roles.rows, staff: staff.rows };
    });
  }

  async saveSetup(ctx: RequestContext, dto: LeaveSetupDto) {
    this.assertHolds(ctx, SETUP);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      await c.query(
        `UPDATE leave_settings SET long_days = $1, back_days = $2, updated_at = now(), updated_by = app.current_user_id() WHERE school_id = app.current_school_id()`,
        [dto.longDays, dto.backDays],
      );
      await c.query(`DELETE FROM leave_approval_levels`);
      const seq: Record<string, number> = { short: 0, long: 0 };
      for (const l of dto.levels) {
        seq[l.chain] = (seq[l.chain] ?? 0) + 1;
        await c.query(
          `INSERT INTO leave_approval_levels (school_id, chain, seq, label, kind, role_code, employee_id, active)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)`,
          [
            l.chain,
            seq[l.chain],
            l.label,
            l.kind,
            l.kind === 'role' ? (l.roleCode ?? null) : null,
            l.kind === 'employee' ? (l.employeeId ?? null) : null,
            l.active,
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'attendance.leave.setup',
        entityType: 'leave_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
    });
    return this.setup(ctx);
  }

  // ---- approvals ------------------------------------------------------------------------------------
  private async approversOf(
    c: PoolClient,
    l: { kind: string; roleCode: string | null; employeeId: string | null },
    studentId: string,
    yearId: string,
  ): Promise<string[]> {
    if (l.kind === 'class_teacher') {
      // the actual class teacher of the pupil's section; a co-class teacher stands in when there is none
      const r = await c.query<{ id: string; actual: boolean }>(
        `SELECT DISTINCT e.user_id::text AS id, ta.is_actual AS actual
           FROM enrolments en JOIN teacher_assignments ta ON ta.class_section_id = en.class_section_id AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL
           JOIN employees e ON e.id = ta.employee_id AND e.user_id IS NOT NULL AND e.deleted_at IS NULL
          WHERE en.student_id = $1 AND en.academic_year_id = $2 AND en.status = 'active'`,
        [studentId, yearId],
      );
      const actual = r.rows.filter((x) => x.actual);
      return (actual.length ? actual : r.rows).map((x) => x.id);
    }
    const r =
      l.kind === 'role'
        ? await c.query<{ id: string }>(
            `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.school_id = app.current_school_id() AND r.code = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
                AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
            [l.roleCode],
          )
        : await c.query<{ id: string }>(
            `SELECT user_id::text AS id FROM employees WHERE id = $1 AND user_id IS NOT NULL AND deleted_at IS NULL`,
            [l.employeeId],
          );
    return r.rows.map((x) => x.id);
  }

  /** One row per level, in order: the first that someone holds may act; a level nobody holds is skipped. */
  private async start(
    c: PoolClient,
    id: string,
    studentId: string,
    yearId: string,
    chain: 'short' | 'long',
  ) {
    const rows: Array<{ label: string; users: string[] }> = [];
    for (const l of (await this.levels(c, chain)).filter((x) => x.active))
      rows.push({ label: l.label, users: await this.approversOf(c, l, studentId, yearId) });
    if (!rows.some((r) => r.users.length))
      rows.push({
        label: 'School admin',
        users: await this.approversOf(
          c,
          { kind: 'role', roleCode: 'school_admin', employeeId: null },
          studentId,
          yearId,
        ),
      });
    let opened = false;
    let seq = 0;
    for (const r of rows) {
      seq += 1;
      const status = !r.users.length ? 'skipped' : opened ? 'waiting' : 'pending';
      if (status === 'pending') opened = true;
      await c.query(
        `INSERT INTO student_leave_approvals (school_id, leave_id, seq, label, approver_user_ids, status, note)
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
  }

  private async find(c: PoolClient, id: string): Promise<StudentLeave> {
    const r = await c.query<Row>(`${LEAVE} WHERE l.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Leave not found', { status: 404 });
    return toLeave(r.rows[0]);
  }

  private async detail(c: PoolClient, id: string) {
    const leave = await this.find(c, id);
    const a = await c.query<Row>(
      `SELECT a.seq, a.label, a.status, a.note, a.acted_at,
              COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = a.acted_by LIMIT 1), u.display_name) AS acted_by,
              (SELECT string_agg(COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = x.id LIMIT 1), x.display_name), ', ')
                 FROM users x WHERE x.id = ANY(a.approver_user_ids)) AS approvers,
              app.current_user_id() = ANY(a.approver_user_ids) AS mine
         FROM student_leave_approvals a LEFT JOIN users u ON u.id = a.acted_by WHERE a.leave_id = $1 ORDER BY a.seq`,
      [id],
    );
    const files = await c.query<{ id: string; name: string | null }>(
      `SELECT id::text, original_name AS name FROM files WHERE id = ANY($1::bigint[])`,
      [leave.fileIds],
    );
    const approvals = a.rows.map((x) => ({
      seq: Number(x.seq),
      label: String(x.label),
      status: String(x.status),
      note: text(x.note),
      actedAt: x.acted_at instanceof Date ? x.acted_at.toISOString() : null,
      actedBy: text(x.acted_by),
      approvers: text(x.approvers),
      mine: Boolean(x.mine),
    }));
    return {
      ...leave,
      files: files.rows.map((f) => ({ id: f.id, name: f.name ?? 'Attachment' })),
      approvals,
      /** The request waits at a level this person holds. */
      canDecide:
        leave.status === 'pending' && approvals.some((x) => x.status === 'pending' && x.mine),
    };
  }

  // ---- the family -----------------------------------------------------------------------------------
  async mine(ctx: RequestContext) {
    this.assertHolds(ctx, APPLY);
    const yearId = this.year(ctx);
    const v = await this.viewer.resolve(ctx, APPLY);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const settings = await this.settings(c);
      const ids = v.kind === 'family' ? v.students.map((s) => s.id) : [];
      const r = await c.query<Row>(
        `${LEAVE} WHERE l.student_id = ANY($1::bigint[]) AND l.academic_year_id = $2 ORDER BY l.from_date DESC, l.id DESC LIMIT 200`,
        [ids, yearId],
      );
      return {
        ...settings,
        types: Object.entries(LEAVE_TYPE_LABEL).map(([value, label]) => ({ value, label })),
        students: v.kind === 'family' ? v.students.map((s) => ({ id: s.id, name: s.name })) : [],
        leaves: r.rows.map(toLeave),
      };
    });
  }

  private async assertMine(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, APPLY);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
  }

  async apply(ctx: RequestContext, dto: LeaveApplyDto) {
    this.assertHolds(ctx, APPLY);
    const yearId = this.year(ctx);
    await this.assertMine(ctx, dto.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settings(c);
      const d = await c.query<{ days: number; too_old: boolean; in_year: boolean }>(
        `SELECT ($2::date - $1::date + 1)::int AS days, $1::date < ${TODAY} - $3::int AS too_old,
                EXISTS (SELECT 1 FROM academic_years ay WHERE ay.id = $4 AND $1::date >= ay.start_date AND $2::date <= ay.end_date) AS in_year`,
        [dto.fromDate, dto.toDate, s.backDays, yearId],
      );
      const { days, too_old, in_year } = d.rows[0]!;
      const fail = (field: string, message: string) => {
        throw new DomainError('validation-failed', message, {
          status: 400,
          extra: { errors: { [field]: message } },
        });
      };
      if (too_old)
        fail(
          'fromDate',
          s.backDays
            ? `Leave can be applied for at most ${String(s.backDays)} day(s) back`
            : 'Leave cannot be applied for a day already gone',
        );
      if (!in_year) fail('toDate', 'The dates are outside this academic session');
      if (days > 90) fail('toDate', 'A leave of more than 90 days needs the school office');
      const long = days > s.longDays;
      if (dto.leaveType === 'medical' && long && dto.fileIds.length === 0)
        fail(
          'files',
          `A medical leave of more than ${String(s.longDays)} day(s) needs the doctor's certificate: attach it`,
        );
      if (dto.fileIds.length) {
        const f = await c.query<{ ok: boolean }>(
          `SELECT (status = 'ready' AND created_by = app.current_user_id() AND size_bytes <= 5242880
                   AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$') AS ok FROM files WHERE id = ANY($1::bigint[])`,
          [dto.fileIds],
        );
        if (f.rows.length !== new Set(dto.fileIds).size || f.rows.some((x) => !x.ok))
          fail('files', 'Attach your own PDF or image files of up to 5 MB');
      }
      const clash = await c.query<{ number: string }>(
        `SELECT COALESCE(number, 'LV-' || id::text) AS number FROM student_leaves
          WHERE student_id = $1 AND status IN ('pending', 'approved') AND from_date <= $3::date
            AND LEAST(to_date, COALESCE(ended_on - 1, to_date)) >= $2::date LIMIT 1`,
        [dto.studentId, dto.fromDate, dto.toDate],
      );
      if (clash.rows[0])
        fail('fromDate', `These dates overlap leave ${clash.rows[0].number}; cancel that first`);
      const r = await c.query<{ id: string }>(
        `INSERT INTO student_leaves (school_id, academic_year_id, student_id, leave_type, from_date, to_date, days, reason, file_ids, chain, applied_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::date, $6, $7, $8::jsonb, $9, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.studentId,
          dto.leaveType,
          dto.fromDate,
          dto.toDate,
          days,
          dto.reason,
          JSON.stringify(dto.fileIds),
          long ? 'long' : 'short',
        ],
      );
      const id = r.rows[0]!.id;
      await c.query(
        `UPDATE student_leaves SET number = 'LV-' || to_char(applied_at AT TIME ZONE ${TZ}, 'YYMM') || '-' || lpad(id::text, 4, '0') WHERE id = $1`,
        [id],
      );
      await this.start(c, id, dto.studentId, yearId, long ? 'long' : 'short');
      await this.audit.stage(ctx, c, {
        action: 'attendance.leave.apply',
        entityType: 'student_leaves',
        entityId: id,
        after: { ...dto, days, long },
      });
      return this.detail(c, id);
    });
  }

  async myLeave(ctx: RequestContext, id: string) {
    this.assertHolds(ctx, APPLY);
    const out = await this.db.tenant(requireTenant(ctx), (c) => this.detail(c, id));
    await this.assertMine(ctx, out.studentId);
    return out;
  }

  /** A leave that waits is withdrawn; an approved one is ended from today (the child is back). */
  async cancel(ctx: RequestContext, id: string) {
    this.assertHolds(ctx, APPLY);
    const before = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    await this.assertMine(ctx, before.studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM student_leaves WHERE id = $1 FOR UPDATE`, [id]);
      const l = await this.find(c, id);
      if (l.status === 'pending') {
        await c.query(
          `UPDATE student_leaves SET status = 'cancelled', decided_at = now(), updated_at = now() WHERE id = $1`,
          [id],
        );
        await c.query(
          `UPDATE student_leave_approvals SET status = 'skipped', note = 'Cancelled by the family' WHERE leave_id = $1 AND status IN ('pending', 'waiting')`,
          [id],
        );
      } else if (l.status === 'approved') {
        const r = await c.query<{ over: boolean; started: boolean }>(
          `SELECT to_date < ${TODAY} AS over, from_date < ${TODAY} AS started FROM student_leaves WHERE id = $1`,
          [id],
        );
        if (r.rows[0]!.over || l.endedOn)
          throw new DomainError('leave.over', 'This leave is already over', { status: 409 });
        // not begun: the whole leave goes; begun: the days from today are given up
        if (r.rows[0]!.started)
          await c.query(
            `UPDATE student_leaves SET ended_on = ${TODAY}, updated_at = now() WHERE id = $1`,
            [id],
          );
        else
          await c.query(
            `UPDATE student_leaves SET status = 'cancelled', updated_at = now() WHERE id = $1`,
            [id],
          );
      } else
        throw new DomainError('leave.decided', 'This leave cannot be cancelled', { status: 409 });
      await this.audit.stage(ctx, c, {
        action: 'attendance.leave.cancel',
        entityType: 'student_leaves',
        entityId: id,
        before: { status: l.status },
      });
      return this.detail(c, id);
    });
  }

  // ---- staff ----------------------------------------------------------------------------------------
  /** Sees every leave of the school (else: the ones that came to a level the person holds). */
  private overseer(ctx: RequestContext): boolean {
    return ctx.permissions?.has(SETUP) === true;
  }

  async list(ctx: RequestContext, q: LeaveListDto) {
    this.assertHolds(ctx, DECIDE, SETUP);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.settings(c);
      const params: unknown[] = [yearId, this.overseer(ctx)];
      const w = [
        `l.academic_year_id = $1`,
        // an approver sees what came to them at any level; the coordinator's office sees all
        `($2 OR EXISTS (SELECT 1 FROM student_leave_approvals a WHERE a.leave_id = l.id AND app.current_user_id() = ANY(a.approver_user_ids)))`,
      ];
      if (q.tab === 'inbox')
        w.push(
          `l.status = 'pending' AND EXISTS (SELECT 1 FROM student_leave_approvals a WHERE a.leave_id = l.id AND a.status = 'pending' AND app.current_user_id() = ANY(a.approver_user_ids))`,
        );
      else if (q.tab !== 'all') {
        params.push(q.tab);
        w.push(`l.status = $${String(params.length)}`);
      }
      if (q.q) {
        params.push(q.q);
        const p = `$${String(params.length)}`;
        w.push(
          `(s.display_name ILIKE '%' || ${p} || '%' OR s.admission_no ILIKE '%' || ${p} || '%' OR l.number ILIKE '%' || ${p} || '%')`,
        );
      }
      const r = await c.query<Row>(
        `${LEAVE} WHERE ${w.join(' AND ')} ORDER BY (l.status = 'pending') DESC, l.applied_at DESC LIMIT 300`,
        params,
      );
      const inbox = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM student_leaves l WHERE l.academic_year_id = $1 AND l.status = 'pending'
            AND EXISTS (SELECT 1 FROM student_leave_approvals a WHERE a.leave_id = l.id AND a.status = 'pending' AND app.current_user_id() = ANY(a.approver_user_ids))`,
        [yearId],
      );
      return { data: r.rows.map(toLeave), inbox: inbox.rows[0]!.n, overseer: this.overseer(ctx) };
    });
  }

  private async assertMaySee(c: PoolClient, ctx: RequestContext, id: string) {
    if (this.overseer(ctx)) return;
    const r = await c.query(
      `SELECT 1 FROM student_leave_approvals WHERE leave_id = $1 AND app.current_user_id() = ANY(approver_user_ids) LIMIT 1`,
      [id],
    );
    if (!r.rowCount) throw new DomainError('not-found', 'Leave not found', { status: 404 });
  }

  async get(ctx: RequestContext, id: string) {
    this.assertHolds(ctx, DECIDE, SETUP);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.assertMaySee(c, ctx, id);
      return this.detail(c, id);
    });
  }

  async decide(ctx: RequestContext, id: string, dto: LeaveDecideDto) {
    this.assertHolds(ctx, DECIDE, SETUP);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT 1 FROM student_leaves WHERE id = $1 FOR UPDATE`, [id]);
      const l = await this.find(c, id);
      if (l.status !== 'pending')
        throw new DomainError('leave.decided', 'This leave has been decided', { status: 409 });
      const mine = await c.query<{ id: string }>(
        `SELECT id::text FROM student_leave_approvals WHERE leave_id = $1 AND status = 'pending' AND app.current_user_id() = ANY(approver_user_ids)
          ORDER BY seq LIMIT 1`,
        [id],
      );
      if (!mine.rows[0])
        throw new DomainError('forbidden', 'This leave is not waiting for your approval', {
          status: 403,
        });
      await c.query(
        `UPDATE student_leave_approvals SET status = $2, acted_by = app.current_user_id(), acted_at = now(), note = $3 WHERE id = $1`,
        [mine.rows[0].id, dto.outcome, dto.note ?? null],
      );
      let final: 'approved' | 'rejected' | null = dto.outcome === 'rejected' ? 'rejected' : null;
      if (!final) {
        const next = await c.query(
          `UPDATE student_leave_approvals SET status = 'pending' WHERE id = (
             SELECT id FROM student_leave_approvals WHERE leave_id = $1 AND status = 'waiting' ORDER BY seq LIMIT 1)`,
          [id],
        );
        if (!next.rowCount) final = 'approved';
      }
      if (final) {
        await c.query(
          `UPDATE student_leaves SET status = $2, decided_at = now(), decision_note = $3, updated_at = now() WHERE id = $1`,
          [id, final, dto.note ?? null],
        );
        await c.query(
          `UPDATE student_leave_approvals SET status = 'skipped', note = 'Not needed' WHERE leave_id = $1 AND status IN ('pending', 'waiting')`,
          [id],
        );
      }
      await this.audit.stage(ctx, c, {
        action: `attendance.leave.${dto.outcome}`,
        entityType: 'student_leaves',
        entityId: id,
        after: { note: dto.note ?? null, final },
      });
      return this.detail(c, id);
    });
  }

  /** The certificate of a leave, for the family that attached it or the staff who may see the leave. */
  async fileUrl(ctx: RequestContext, id: string, fileId: string, family: boolean) {
    const leave = await this.db.tenant(requireTenant(ctx), async (c) => {
      if (!family) await this.assertMaySee(c, ctx, id);
      return this.find(c, id);
    });
    if (family) await this.assertMine(ctx, leave.studentId);
    if (!leave.fileIds.includes(fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }
}
