import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type {
  ActivityReportDto,
  ActivitySettingsDto,
  CategoryDto,
  DayQueryDto,
  MarkLeaveDto,
  MyReportDto,
  RangeQueryDto,
  ReviewDto,
  SaveLogDto,
} from './activity-log.dto';
import { ACTIVITY, LEAVE_TYPES } from './activity-log.dto';

const DEFAULTS: Array<[string, string]> = [
  ['teaching', 'Teaching'],
  ['substitution', 'Substitution period'],
  ['correction', 'Correction and checking'],
  ['preparation', 'Lesson preparation'],
  ['meeting', 'Staff meeting'],
  ['parent_meeting', 'Meeting with parents'],
  ['duty', 'Duty (bus, gate, exam, assembly)'],
  ['event', 'Event or activity'],
  ['office', 'Office work'],
  ['training', 'Training'],
  ['other', 'Other'],
];
type State = 'draft' | 'submitted' | 'reviewed' | 'returned';

const istNow = () => new Date(Date.now() + 5.5 * 3_600_000);
const today = () => istNow().toISOString().slice(0, 10);
const shift = (date: string, by: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hours = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * The employee's daily activity log (0095): time slots of what was done in the day, started from the
 * timetable and substitutions, submitted by the employee (that is enough) and reviewed by exception.
 */
@Injectable()
export class ActivityLogService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private need(ctx: RequestContext, permission: string) {
    if (!ctx.permissions?.has(permission))
      throw new DomainError('permission-denied', `This needs ${permission}`, { status: 403 });
  }

  // ---- set-up --------------------------------------------------------------------------------------
  private async setupIn(c: PoolClient) {
    // a school that never opened the log gets the usual categories
    await c.query(
      `INSERT INTO activity_categories (school_id, code, name, sort_order)
       SELECT app.current_school_id(), x.code, x.name, x.n * 10
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS x(code, name, n)
        WHERE NOT EXISTS (SELECT 1 FROM activity_categories WHERE school_id = app.current_school_id())`,
      [DEFAULTS.map((d) => d[0]), DEFAULTS.map((d) => d[1])],
    );
    const cats = await c.query<{
      id: string;
      code: string;
      name: string;
      sort_order: number;
      status: string;
    }>(
      `SELECT id::text, code, name, sort_order, status FROM activity_categories ORDER BY sort_order, name`,
    );
    const s = await c.query<{ cutoff: string; back_days: number }>(
      `SELECT to_char(cutoff_time, 'HH24:MI') AS cutoff, back_days FROM activity_settings WHERE school_id = app.current_school_id()`,
    );
    return {
      categories: cats.rows.map((x) => ({
        id: x.id,
        code: x.code,
        name: x.name,
        sortOrder: x.sort_order,
        active: x.status === 'active',
      })),
      cutoffTime: s.rows[0]?.cutoff ?? '18:00',
      backDays: s.rows[0]?.back_days ?? 2,
    };
  }

  setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.setupIn(c));
  }

  async saveSettings(ctx: RequestContext, dto: ActivitySettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO activity_settings (school_id, cutoff_time, back_days, updated_by)
         VALUES (app.current_school_id(), $1::time, $2, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET cutoff_time = EXCLUDED.cutoff_time, back_days = EXCLUDED.back_days,
           updated_at = now(), updated_by = app.current_user_id()`,
        [dto.cutoffTime, dto.backDays],
      );
      await this.audit.stage(ctx, c, {
        action: 'staff.activity.settings',
        entityType: 'activity_settings',
        entityId: requireTenant(ctx).schoolId,
        after: dto,
      });
      return this.setupIn(c);
    });
  }

  async saveCategory(ctx: RequestContext, dto: CategoryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.setupIn(c);
      if (dto.id)
        await c.query(
          `UPDATE activity_categories SET name = $2, sort_order = $3, status = $4 WHERE id = $1`,
          [dto.id, dto.name, dto.sortOrder, dto.status],
        );
      else {
        const code =
          dto.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40) || 'category';
        try {
          await c.query(
            `INSERT INTO activity_categories (school_id, code, name, sort_order, status) VALUES (app.current_school_id(), $1, $2, $3, $4)`,
            [code, dto.name, dto.sortOrder, dto.status],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505')
            throw new DomainError('validation-failed', 'A category with this name already exists', {
              status: 400,
            });
          throw error;
        }
      }
      return this.setupIn(c);
    });
  }

  // ---- my day --------------------------------------------------------------------------------------
  private async me(c: PoolClient): Promise<{ id: string; name: string }> {
    const r = await c.query<{ id: string; name: string }>(
      `SELECT id::text, display_name AS name FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    if (!r.rows[0])
      throw new DomainError(
        'activity.not_staff',
        'Your sign-in is not linked to an employee record; ask the office to link it',
        { status: 409 },
      );
    return r.rows[0];
  }

  private async logIn(c: PoolClient, employeeId: string, date: string) {
    const l = await c.query<Record<string, unknown>>(
      `SELECT l.id::text, l.state, l.tomorrow_plan, l.pending_note, l.submitted_at, l.late, l.review_note, l.reviewed_at, l.leave_kind, l.leave_type, l.leave_reason, l.edited_at,
              (SELECT display_name FROM users WHERE id = l.reviewed_by) AS reviewed_by
         FROM activity_logs l WHERE l.employee_id = $1 AND l.on_date = $2::date`,
      [employeeId, date],
    );
    const log = l.rows[0];
    const e = log
      ? await c.query<Record<string, unknown>>(
          `SELECT e.id::text, to_char(e.from_time, 'HH24:MI') AS f, to_char(e.to_time, 'HH24:MI') AS t, e.category_id::text,
                  k.name AS category, e.description, e.source
             FROM activity_entries e JOIN activity_categories k ON k.id = e.category_id WHERE e.log_id = $1 ORDER BY e.from_time, e.id`,
          [log.id],
        )
      : { rows: [] as Array<Record<string, unknown>> };
    const entries = e.rows.map((x) => ({
      id: String(x.id),
      from: String(x.f),
      to: String(x.t),
      categoryId: String(x.category_id),
      category: String(x.category),
      description: String(x.description),
      source: String(x.source),
    }));
    return {
      id: log ? String(log.id) : null,
      date,
      state: (log?.state as State | undefined) ?? null,
      tomorrowPlan: (log?.tomorrow_plan as string | null) ?? null,
      pendingNote: (log?.pending_note as string | null) ?? null,
      submittedAt: log?.submitted_at ? (log.submitted_at as Date).toISOString() : null,
      late: Boolean(log?.late),
      reviewNote: (log?.review_note as string | null) ?? null,
      reviewedBy: (log?.reviewed_by as string | null) ?? null,
      reviewedAt: log?.reviewed_at ? (log.reviewed_at as Date).toISOString() : null,
      leave: log?.leave_kind
        ? {
            kind: log.leave_kind as 'full' | 'half',
            type: (log.leave_type as string | null) ?? '',
            reason: (log.leave_reason as string | null) ?? null,
          }
        : null,
      editedAt: log?.edited_at ? (log.edited_at as Date).toISOString() : null,
      entries,
      minutes: entries.reduce((n, x) => n + minutes(x.to) - minutes(x.from), 0),
    };
  }

  /** What the system already knows of the employee's day: timetable periods and substitutions. */
  private async known(c: PoolClient, employeeId: string, date: string, yearId: string | null) {
    const r = await c.query<{
      f: string;
      t: string;
      what: string;
      source: 'timetable' | 'substitution';
    }>(
      `SELECT to_char(p.starts_at, 'HH24:MI') AS f, to_char(p.ends_at, 'HH24:MI') AS t,
              k.code || '-' || cs.name || COALESCE(' · ' || s.name, '') || ' (' || p.name || ')' AS what, 'timetable' AS source
         FROM timetable_slots ts JOIN timetable_periods p ON p.id = ts.period_id
         JOIN class_sections cs ON cs.id = ts.class_section_id JOIN classes k ON k.id = cs.class_id
         LEFT JOIN subjects s ON s.id = ts.subject_id
        WHERE ts.employee_id = $1 AND ts.academic_year_id = $3 AND ts.weekday = EXTRACT(ISODOW FROM $2::date)::int
          AND NOT EXISTS (SELECT 1 FROM timetable_substitutions x WHERE x.slot_id = ts.id AND x.on_date = $2::date)
        UNION ALL
       SELECT to_char(p.starts_at, 'HH24:MI'), to_char(p.ends_at, 'HH24:MI'),
              'Substitution: ' || k.code || '-' || cs.name || COALESCE(' · ' || s.name, '') || ' (' || p.name || ')', 'substitution'
         FROM timetable_substitutions x JOIN timetable_periods p ON p.id = x.period_id
         JOIN class_sections cs ON cs.id = x.class_section_id JOIN classes k ON k.id = cs.class_id
         LEFT JOIN subjects s ON s.id = x.subject_id
        WHERE x.substitute_employee_id = $1 AND x.on_date = $2::date
        ORDER BY 1`,
      [employeeId, date, yearId],
    );
    return r.rows.map((x) => ({ from: x.f, to: x.t, description: x.what, source: x.source }));
  }

  async mine(ctx: RequestContext, date?: string) {
    const tenant = requireTenant(ctx);
    const day = date ?? today();
    return this.db.tenant(tenant, async (c) => {
      const me = await this.me(c);
      const setup = await this.setupIn(c);
      const log = await this.logIn(c, me.id, day);
      const known = await this.known(c, me.id, day, tenant.academicYearId ?? null);
      const cat = (code: string) => setup.categories.find((k) => k.code === code)?.id ?? null;
      const recent = await c.query<{ d: string; state: State | null; late: boolean | null }>(
        `SELECT g.d::date::text AS d, l.state, l.late
           FROM generate_series($2::date - 6, $2::date, interval '1 day') AS g(d)
           LEFT JOIN activity_logs l ON l.employee_id = $1 AND l.on_date = g.d::date ORDER BY g.d DESC`,
        [me.id, today()],
      );
      const oldest = shift(today(), -setup.backDays);
      return {
        employee: me,
        log,
        // offered while the day is still empty: the teacher confirms and adds the rest
        suggested:
          log.entries.length === 0
            ? known.map((k) => ({
                ...k,
                categoryId: cat(k.source === 'substitution' ? 'substitution' : 'teaching'),
              }))
            : [],
        categories: setup.categories.filter((k) => k.active),
        cutoffTime: setup.cutoffTime,
        backDays: setup.backDays,
        // a submitted day may still be corrected until someone reviews it
        editable:
          day <= today() &&
          (log.state === 'returned' ||
            (day >= oldest &&
              (log.state === null || log.state === 'draft' || log.state === 'submitted'))),
        leaveTypes: [...LEAVE_TYPES],
        recent: recent.rows.map((x) => ({ date: x.d, state: x.state, late: Boolean(x.late) })),
      };
    });
  }

  async save(ctx: RequestContext, dto: SaveLogDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const me = await this.me(c);
      const setup = await this.setupIn(c);
      if (dto.date > today())
        throw new DomainError('validation-failed', 'A future day cannot be filled', {
          status: 400,
        });
      const cur = await c.query<{ id: string; state: State }>(
        `SELECT id::text, state FROM activity_logs WHERE employee_id = $1 AND on_date = $2::date FOR UPDATE`,
        [me.id, dto.date],
      );
      const state = cur.rows[0]?.state ?? null;
      if (state === 'reviewed')
        throw new DomainError(
          'activity.locked',
          'This day is reviewed; it can be changed only when it is sent back',
          { status: 409 },
        );
      // a submitted day that is corrected stays submitted
      const wasSubmitted = state === 'submitted';
      const submit = dto.submit || wasSubmitted;
      const leave = dto.leave ?? null;
      if (state !== 'returned' && dto.date < shift(today(), -setup.backDays))
        throw new DomainError(
          'activity.too_old',
          `A day can be filled up to ${String(setup.backDays)} day(s) later; ask the office to reopen it`,
          { status: 409 },
        );
      if (submit && dto.entries.length === 0 && leave?.kind !== 'full')
        throw new DomainError(
          'validation-failed',
          leave
            ? 'For a half day of leave, add what you did in the other half'
            : 'Add at least one activity before submitting (or mark the day as leave)',
          { status: 400 },
        );
      const sorted = [...dto.entries].sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 1; i < sorted.length; i += 1)
        if (sorted[i]!.from < sorted[i - 1]!.to)
          throw new DomainError(
            'validation-failed',
            `Two activities overlap: ${sorted[i - 1]!.from}–${sorted[i - 1]!.to} and ${sorted[i]!.from}–${sorted[i]!.to}`,
            { status: 400 },
          );
      const active = new Set(setup.categories.filter((k) => k.active).map((k) => k.id));
      if (dto.entries.some((e) => !active.has(e.categoryId)))
        throw new DomainError('validation-failed', 'Choose a category from the list', {
          status: 400,
        });
      // late: submitted after the cut-off of its own day, or on a later day
      const nowTime = istNow().toISOString().slice(11, 16);
      const late = submit && (dto.date < today() || nowTime > setup.cutoffTime);
      const id =
        cur.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `INSERT INTO activity_logs (school_id, employee_id, on_date) VALUES (app.current_school_id(), $1, $2::date) RETURNING id::text`,
            [me.id, dto.date],
          )
        ).rows[0]!.id;
      await c.query(
        `UPDATE activity_logs SET tomorrow_plan = $2, pending_note = $3, updated_at = now(),
                state = CASE WHEN $4 THEN 'submitted' ELSE CASE WHEN state = 'returned' THEN 'returned' ELSE 'draft' END END,
                submitted_at = CASE WHEN $4 AND NOT $6 THEN now() ELSE submitted_at END,
                late = CASE WHEN $4 AND NOT $6 THEN $5 ELSE late END,
                edited_at = CASE WHEN $6 THEN now() ELSE edited_at END,
                leave_kind = $7, leave_type = $8, leave_reason = $9,
                leave_by = CASE WHEN $7::text IS NULL THEN NULL ELSE app.current_user_id() END
          WHERE id = $1`,
        [
          id,
          dto.tomorrowPlan ?? null,
          dto.pendingNote ?? null,
          submit,
          late,
          wasSubmitted,
          leave?.kind ?? null,
          leave?.type ?? null,
          leave?.reason ?? null,
        ],
      );
      await c.query(`DELETE FROM activity_entries WHERE log_id = $1`, [id]);
      for (const e of sorted)
        await c.query(
          `INSERT INTO activity_entries (school_id, log_id, from_time, to_time, category_id, description, source)
           VALUES (app.current_school_id(), $1, $2::time, $3::time, $4, $5, $6)`,
          [id, e.from, e.to, e.categoryId, e.description, e.source],
        );
      if (submit)
        await this.audit.stage(ctx, c, {
          action: wasSubmitted ? 'staff.activity.edit' : 'staff.activity.submit',
          entityType: 'activity_logs',
          entityId: id,
          after: { date: dto.date, entries: sorted.length, late, leave: leave?.kind ?? null },
        });
      return this.logIn(c, me.id, dto.date);
    });
  }

  // ---- review --------------------------------------------------------------------------------------
  /** Every active employee on a day: submitted, late, sent back, or nothing yet. */
  private async dayIn(c: PoolClient, date: string, q: { department?: string; state?: string }) {
    const r = await c.query<Record<string, unknown>>(
      `SELECT e.id::text AS employee_id, e.employee_code, e.display_name AS name, COALESCE(e.department, '') AS department,
              e.designation, l.id::text AS log_id, l.state, l.late, l.submitted_at, l.leave_kind, l.leave_type, l.edited_at,
              COALESCE((SELECT sum(EXTRACT(EPOCH FROM (x.to_time - x.from_time)) / 60) FROM activity_entries x WHERE x.log_id = l.id), 0)::int AS minutes,
              (SELECT count(*) FROM activity_entries x WHERE x.log_id = l.id)::int AS entries
         FROM employees e LEFT JOIN activity_logs l ON l.employee_id = e.id AND l.on_date = $1::date
        WHERE e.deleted_at IS NULL AND e.status = 'active' AND ($2::text IS NULL OR e.department = $2)
        ORDER BY e.department NULLS LAST, e.display_name`,
      [date, q.department ?? null],
    );
    return r.rows
      .map((x) => ({
        employeeId: String(x.employee_id),
        employeeCode: String(x.employee_code),
        name: String(x.name),
        department: String(x.department),
        designation: (x.designation as string | null) ?? null,
        logId: (x.log_id as string | null) ?? null,
        state: ((x.state as State | null) ?? 'missing') as State | 'missing',
        leave: (x.leave_kind as 'full' | 'half' | null) ?? null,
        leaveType: (x.leave_type as string | null) ?? null,
        edited: Boolean(x.edited_at),
        late: Boolean(x.late),
        submittedAt: x.submitted_at ? (x.submitted_at as Date).toISOString() : null,
        minutes: Number(x.minutes),
        entries: Number(x.entries),
      }))
      .filter((x) =>
        !q.state ? true : q.state === 'leave' ? x.leave !== null : x.state === q.state,
      );
  }

  async day(ctx: RequestContext, q: DayQueryDto) {
    const date = q.date ?? today();
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const all = await this.dayIn(c, date, { department: q.department });
      const count = (s: string) => all.filter((x) => x.state === s).length;
      const departments = await c.query<{ d: string }>(
        `SELECT DISTINCT department AS d FROM employees WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> '' ORDER BY 1`,
      );
      return {
        date,
        counts: {
          employees: all.length,
          submitted: count('submitted') + count('reviewed'),
          reviewed: count('reviewed'),
          returned: count('returned'),
          draft: count('draft'),
          missing: count('missing'),
          late: all.filter((x) => x.late).length,
          leave: all.filter((x) => x.leave === 'full').length,
          halfLeave: all.filter((x) => x.leave === 'half').length,
        },
        departments: departments.rows.map((x) => x.d),
        data: !q.state
          ? all
          : q.state === 'leave'
            ? all.filter((x) => x.leave !== null)
            : all.filter((x) => x.state === q.state),
      };
    });
  }

  async detail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        employee_id: string;
        d: string;
        name: string;
        code: string;
        department: string | null;
      }>(
        `SELECT l.employee_id::text, l.on_date::text AS d, e.display_name AS name, e.employee_code AS code, e.department
           FROM activity_logs l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`,
        [id],
      );
      const x = r.rows[0];
      if (!x) throw new DomainError('not-found', 'Log not found', { status: 404 });
      // the employee reads their own; anyone else needs the review permission
      const own = await c.query(
        `SELECT 1 FROM employees WHERE id = $1 AND user_id = app.current_user_id()`,
        [x.employee_id],
      );
      if (!own.rowCount) this.need(ctx, ACTIVITY.review);
      return {
        employee: { id: x.employee_id, name: x.name, code: x.code, department: x.department },
        log: await this.logIn(c, x.employee_id, x.d),
      };
    });
  }

  async review(ctx: RequestContext, id: string, dto: ReviewDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ state: State }>(
        `SELECT state FROM activity_logs WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Log not found', { status: 404 });
      if (!['submitted', 'reviewed'].includes(r.rows[0].state))
        throw new DomainError('activity.not_submitted', 'Only a submitted log is reviewed', {
          status: 409,
        });
      await c.query(
        `UPDATE activity_logs SET state = $2, review_note = $3, reviewed_by = app.current_user_id(), reviewed_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.action, dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `staff.activity.${dto.action}`,
        entityType: 'activity_logs',
        entityId: id,
        after: { note: dto.note ?? null },
      });
      return { id, state: dto.action };
    });
  }

  /** The office marks an employee on leave for a day: the day counts as leave, not as "not filled". */
  async markLeave(ctx: RequestContext, dto: MarkLeaveDto) {
    if (dto.date > shift(today(), 60))
      throw new DomainError('validation-failed', 'That date is too far ahead', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await c.query(
        `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.employeeId],
      );
      if (!e.rowCount) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const r = await c.query<{ id: string }>(
        `INSERT INTO activity_logs (school_id, employee_id, on_date, state, submitted_at, leave_kind, leave_type, leave_reason, leave_by)
         VALUES (app.current_school_id(), $1, $2::date, 'submitted', now(), $3, $4, $5, app.current_user_id())
         ON CONFLICT (employee_id, on_date) DO UPDATE SET leave_kind = EXCLUDED.leave_kind, leave_type = EXCLUDED.leave_type,
           leave_reason = EXCLUDED.leave_reason, leave_by = app.current_user_id(), updated_at = now(),
           state = CASE WHEN activity_logs.state IN ('draft', 'returned') THEN 'submitted' ELSE activity_logs.state END,
           submitted_at = COALESCE(activity_logs.submitted_at, now())
         RETURNING id::text`,
        [dto.employeeId, dto.date, dto.kind, dto.type, dto.reason ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'staff.activity.leave',
        entityType: 'activity_logs',
        entityId: r.rows[0]!.id,
        after: { employeeId: dto.employeeId, date: dto.date, kind: dto.kind, type: dto.type },
      });
      return { id: r.rows[0]!.id };
    });
  }

  /** My own log between two dates, as Excel or PDF. */
  async myReport(ctx: RequestContext, q: MyReportDto) {
    const me = await this.db.tenant(requireTenant(ctx), (c) => this.me(c));
    return this.reportFile(ctx, {
      report: 'employee',
      employeeId: me.id,
      from: q.from,
      to: q.to,
      format: q.format,
    });
  }

  // ---- dashboard and reports -----------------------------------------------------------------------
  private range(q: RangeQueryDto) {
    const to = q.to ?? today();
    const from = q.from ?? shift(to, -29);
    if (from > to)
      throw new DomainError('validation-failed', 'From must not be after To', { status: 400 });
    if (shift(from, 366) < to)
      throw new DomainError('validation-failed', 'Choose a year or less', { status: 400 });
    return { from, to };
  }

  /** Working days of the range (not a Sunday, not a holiday for employees), up to today. */
  private static readonly DAYS = `SELECT g.d::date AS d FROM generate_series($1::date, LEAST($2::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), interval '1 day') AS g(d)
     WHERE EXTRACT(ISODOW FROM g.d) <> 7
       AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.starts_on <= g.d::date AND h.ends_on >= g.d::date AND h.kind <> 'working_day' AND h.applies_to IN ('everyone', 'employees'))`;

  private async complianceIn(c: PoolClient, from: string, to: string, q: RangeQueryDto) {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- DAYS is a constant; values are bound
      `WITH days AS (${ActivityLogService.DAYS})
       SELECT e.id::text AS employee_id, e.employee_code, e.display_name AS name, COALESCE(e.department, 'No department') AS department,
              (SELECT count(*) FROM days)::int AS working,
              count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed') AND l.leave_kind IS DISTINCT FROM 'full')::int AS submitted,
              count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed') AND l.leave_kind = 'full')::int AS on_leave,
              count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed') AND l.leave_kind = 'half')::int AS half_leave,
              count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed') AND l.late)::int AS late,
              count(l.id) FILTER (WHERE l.state = 'returned')::int AS returned,
              COALESCE(sum((SELECT sum(EXTRACT(EPOCH FROM (x.to_time - x.from_time)) / 60) FROM activity_entries x WHERE x.log_id = l.id))
                         FILTER (WHERE l.state IN ('submitted', 'reviewed')), 0)::int AS minutes
         FROM employees e
         LEFT JOIN activity_logs l ON l.employee_id = e.id AND l.on_date IN (SELECT d FROM days)
        WHERE e.deleted_at IS NULL AND e.status = 'active'
          AND ($3::text IS NULL OR e.department = $3) AND ($4::bigint IS NULL OR e.id = $4)
        GROUP BY e.id, e.employee_code, e.display_name, e.department
        ORDER BY 4, 3`,
      [from, to, q.department ?? null, q.employeeId ?? null],
    );
    return r.rows.map((x) => {
      const working = Number(x.working);
      const submitted = Number(x.submitted);
      const leave = Number(x.on_leave);
      return {
        employeeId: String(x.employee_id),
        employeeCode: String(x.employee_code),
        name: String(x.name),
        department: String(x.department),
        working,
        submitted,
        // full days of leave are not working days to fill; half days were filled
        leave,
        halfLeave: Number(x.half_leave),
        missed: Math.max(0, working - submitted - leave),
        late: Number(x.late),
        returned: Number(x.returned),
        minutes: Number(x.minutes),
        percent: working - leave > 0 ? Math.round((submitted / (working - leave)) * 100) : 0,
      };
    });
  }

  private async categoriesIn(c: PoolClient, from: string, to: string, q: RangeQueryDto) {
    const r = await c.query<{ name: string; minutes: number; entries: number; people: number }>(
      `SELECT k.name, sum(EXTRACT(EPOCH FROM (x.to_time - x.from_time)) / 60)::int AS minutes, count(*)::int AS entries,
              count(DISTINCT l.employee_id)::int AS people
         FROM activity_entries x JOIN activity_logs l ON l.id = x.log_id JOIN activity_categories k ON k.id = x.category_id
         JOIN employees e ON e.id = l.employee_id
        WHERE l.on_date BETWEEN $1::date AND $2::date AND l.state IN ('submitted', 'reviewed')
          AND ($3::text IS NULL OR e.department = $3) AND ($4::bigint IS NULL OR e.id = $4)
        GROUP BY k.name, k.sort_order ORDER BY 2 DESC`,
      [from, to, q.department ?? null, q.employeeId ?? null],
    );
    return r.rows;
  }

  async dashboard(ctx: RequestContext, q: RangeQueryDto) {
    const { from, to } = this.range(q);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const people = await this.complianceIn(c, from, to, q);
      const categories = await this.categoriesIn(c, from, to, q);
      const todayRows = await this.dayIn(c, today(), { department: q.department });
      const trend = await c.query<{ d: string; submitted: number; late: number }>(
        // eslint-disable-next-line no-restricted-syntax -- DAYS is a constant; values are bound
        `WITH days AS (${ActivityLogService.DAYS})
         SELECT days.d::text AS d,
                count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed'))::int AS submitted,
                count(l.id) FILTER (WHERE l.state IN ('submitted', 'reviewed') AND l.late)::int AS late
           FROM days LEFT JOIN activity_logs l ON l.on_date = days.d
            AND ($3::text IS NULL OR l.employee_id IN (SELECT id FROM employees WHERE department = $3))
          GROUP BY days.d ORDER BY days.d DESC LIMIT 14`,
        [from, to, q.department ?? null],
      );
      const depts = new Map<string, { working: number; submitted: number; people: number }>();
      for (const p of people) {
        const g = depts.get(p.department) ?? { working: 0, submitted: 0, people: 0 };
        g.working += p.working - p.leave;
        g.submitted += p.submitted;
        g.people += 1;
        depts.set(p.department, g);
      }
      const working = people.reduce((n, p) => n + p.working - p.leave, 0);
      const submitted = people.reduce((n, p) => n + p.submitted, 0);
      const done = todayRows.filter((x) => x.state === 'submitted' || x.state === 'reviewed');
      return {
        from,
        to,
        kpis: {
          employees: people.length,
          percent: working ? Math.round((submitted / working) * 100) : 0,
          todaySubmitted: done.length,
          todayMissing: todayRows.length - done.length,
          todayLeave: todayRows.filter((x) => x.leave === 'full').length,
          leaveDays: people.reduce((n, p) => n + p.leave, 0),
          halfLeaveDays: people.reduce((n, p) => n + p.halfLeave, 0),
          late: people.reduce((n, p) => n + p.late, 0),
          returned: people.reduce((n, p) => n + p.returned, 0),
          hours: Math.round(people.reduce((n, p) => n + p.minutes, 0) / 60),
        },
        byDepartment: [...depts.entries()].map(([label, g]) => ({
          label,
          people: g.people,
          percent: g.working ? Math.round((g.submitted / g.working) * 100) : 0,
        })),
        byCategory: categories.map((k) => ({
          label: k.name,
          hours: Math.round(k.minutes / 6) / 10,
        })),
        trend: trend.rows
          .reverse()
          .map((x) => ({ date: x.d, submitted: x.submitted, late: x.late })),
        defaulters: [...people]
          .filter((p) => p.missed > 0)
          .sort((a, b) => b.missed - a.missed)
          .slice(0, 15),
        onLeaveToday: todayRows
          .filter((x) => x.leave !== null)
          .map((x) => ({
            name: x.name,
            department: x.department,
            kind: x.leave,
            type: x.leaveType,
          })),
        leaveByEmployee: [...people]
          .filter((p) => p.leave + p.halfLeave > 0)
          .sort((a, b) => b.leave + b.halfLeave / 2 - (a.leave + a.halfLeave / 2))
          .slice(0, 15)
          .map((p) => ({
            name: p.name,
            department: p.department,
            full: p.leave,
            half: p.halfLeave,
          })),
        missingToday: todayRows
          .filter((x) => x.state !== 'submitted' && x.state !== 'reviewed')
          .slice(0, 30)
          .map((x) => ({ name: x.name, department: x.department, state: x.state })),
      };
    });
  }

  async compliance(ctx: RequestContext, q: RangeQueryDto) {
    const { from, to } = this.range(q);
    return {
      from,
      to,
      data: await this.db.tenant(requireTenant(ctx), (c) => this.complianceIn(c, from, to, q)),
    };
  }

  /** Compliance, hours by category, one employee's days, or one day's sheet, as Excel or PDF. */
  async reportFile(ctx: RequestContext, q: ActivityReportDto) {
    const tenant = requireTenant(ctx);
    const head = await this.db.tenant(tenant, (c) => schoolHead(c));
    const base = { school: head.name, address: head.address };
    const who = q.department ? `Department ${q.department}` : 'All departments';
    if (q.report === 'day') {
      const date = q.date ?? today();
      const rows = await this.db.tenant(tenant, (c) => this.dayIn(c, date, q));
      const STATE = {
        submitted: 'Submitted',
        reviewed: 'Reviewed',
        returned: 'Sent back',
        draft: 'Draft',
        missing: 'Not filled',
      };
      return registerFile(
        {
          ...base,
          report: 'Daily activity log: status of the day',
          details: [`Date ${date}`, who, generatedOn()],
          legend: `${String(rows.length)} employee(s)`,
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'Emp. code', width: 8 },
            { label: 'Employee', width: 18 },
            { label: 'Department', width: 12 },
            { label: 'Status', width: 8 },
            { label: 'Leave', width: 10 },
            { label: 'Late', width: 4 },
            { label: 'Activities', width: 5, right: true },
            { label: 'Time logged', width: 7 },
          ],
          rows: rows.map((r, i) => [
            i + 1,
            r.employeeCode,
            r.name,
            r.department,
            STATE[r.state],
            r.leave
              ? `${r.leave === 'full' ? 'Full day' : 'Half day'}${r.leaveType ? ` · ${r.leaveType}` : ''}`
              : '',
            r.late ? 'Yes' : '',
            r.entries,
            r.minutes ? hours(r.minutes) : '',
          ]),
          filename: `activity-log-day-${date}`,
        },
        q.format,
      );
    }
    const { from, to } = this.range(q);
    const period = `From ${from} to ${to}`;
    if (q.report === 'category') {
      const rows = await this.db.tenant(tenant, (c) => this.categoriesIn(c, from, to, q));
      const total = rows.reduce((n, r) => n + r.minutes, 0);
      return registerFile(
        {
          ...base,
          report: 'Daily activity log: time by category',
          details: [period, who, generatedOn()],
          legend: `Total ${hours(total)} in submitted logs`,
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'Category', width: 22 },
            { label: 'Activities', width: 6, right: true },
            { label: 'Employees', width: 6, right: true },
            { label: 'Time', width: 8 },
            { label: 'Share %', width: 5, right: true },
          ],
          rows: rows.map((r, i) => [
            i + 1,
            r.name,
            r.entries,
            r.people,
            hours(r.minutes),
            total ? Math.round((r.minutes / total) * 100) : 0,
          ]),
          filename: `activity-log-categories-${to}`,
        },
        q.format,
      );
    }
    if (q.report === 'employee') {
      if (!q.employeeId)
        throw new DomainError('validation-failed', 'Choose the employee', { status: 400 });
      const data = await this.db.tenant(tenant, async (c) => {
        const e = await c.query<{ name: string; code: string }>(
          `SELECT display_name AS name, employee_code AS code FROM employees WHERE id = $1`,
          [q.employeeId],
        );
        const r = await c.query<Record<string, unknown>>(
          `SELECT l.on_date::text AS d, l.state, l.late, to_char(x.from_time, 'HH24:MI') AS f, to_char(x.to_time, 'HH24:MI') AS t,
                  k.name AS category, x.description
             FROM activity_logs l JOIN activity_entries x ON x.log_id = l.id JOIN activity_categories k ON k.id = x.category_id
            WHERE l.employee_id = $1 AND l.on_date BETWEEN $2::date AND $3::date AND l.state <> 'draft'
            UNION ALL
           SELECT l.on_date::text, l.state, l.late, '', '', 'Leave',
                  CASE l.leave_kind WHEN 'full' THEN 'Full day' ELSE 'Half day' END || ' · ' || COALESCE(l.leave_type, '') || COALESCE(' · ' || l.leave_reason, '')
             FROM activity_logs l
            WHERE l.employee_id = $1 AND l.on_date BETWEEN $2::date AND $3::date AND l.state <> 'draft' AND l.leave_kind IS NOT NULL
            ORDER BY 1, 4`,
          [q.employeeId, from, to],
        );
        return { who: e.rows[0], rows: r.rows };
      });
      return registerFile(
        {
          ...base,
          report: 'Daily activity log of an employee',
          details: [`${data.who?.name ?? ''} (${data.who?.code ?? ''})`, period, generatedOn()],
          legend: `${String(data.rows.length)} activity line(s)`,
          columns: [
            { label: 'Date', width: 7 },
            { label: 'From', width: 4 },
            { label: 'To', width: 4 },
            { label: 'Category', width: 12 },
            { label: 'What was done', width: 34 },
            { label: 'Log', width: 7 },
          ],
          rows: data.rows.map((r) => [
            String(r.d),
            String(r.f),
            String(r.t),
            String(r.category),
            String(r.description),
            `${String(r.state)}${r.late ? ' (late)' : ''}`,
          ]),
          filename: `activity-log-${data.who?.code ?? 'employee'}-${to}`,
        },
        q.format,
      );
    }
    const rows = await this.db.tenant(tenant, (c) => this.complianceIn(c, from, to, q));
    return registerFile(
      {
        ...base,
        report: 'Daily activity log: submission by employee',
        details: [period, who, generatedOn()],
        legend: `${String(rows.length)} employee(s) · working days exclude Sundays and staff holidays`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Emp. code', width: 8 },
          { label: 'Employee', width: 18 },
          { label: 'Department', width: 12 },
          { label: 'Working days', width: 6, right: true },
          { label: 'Submitted', width: 6, right: true },
          { label: 'On leave', width: 5, right: true },
          { label: 'Half leave', width: 5, right: true },
          { label: 'Not filled', width: 6, right: true },
          { label: 'Late', width: 4, right: true },
          { label: 'Sent back', width: 5, right: true },
          { label: 'Submitted %', width: 6, right: true },
          { label: 'Time logged', width: 8 },
        ],
        rows: rows.map((r, i) => [
          i + 1,
          r.employeeCode,
          r.name,
          r.department,
          r.working,
          r.submitted,
          r.leave,
          r.halfLeave,
          r.missed,
          r.late,
          r.returned,
          r.percent,
          hours(r.minutes),
        ]),
        filename: `activity-log-compliance-${to}`,
      },
      q.format,
    );
  }
}
