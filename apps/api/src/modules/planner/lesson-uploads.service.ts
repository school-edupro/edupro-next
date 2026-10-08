/* eslint-disable no-restricted-syntax -- SQL here is assembled from constant fragments of this file (the select list, the approver tests, the fixed conditions); every value is a bound parameter */
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import { sanitizeEmailHtml } from '../comms/email-html';
import { FilesService } from '../files/files.service';
import type {
  LessonDecideDto,
  LessonListDto,
  LessonRangeDto,
  LessonRuleDto,
  LessonUploadDto,
} from './planner.dto';

const MANAGE = 'academics.lesson_plan.manage';
const SETUP = 'academics.lesson_plan.setup';

/** The current user may act at the level the lesson waits at: named themself, or holding the named role. */
const MY_TURN = `EXISTS (SELECT 1 FROM lesson_upload_approvals a
   WHERE a.lesson_id = l.id AND a.level = l.current_level AND a.state = 'pending' AND l.status = 'pending' AND (
        (a.kind = 'employee' AND a.approver_employee_id IN (SELECT id FROM employees WHERE user_id = app.current_user_id()))
     OR (a.kind = 'role' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                      WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id()
                                        AND ur.revoked_at IS NULL AND r.code = a.role_code))))`;
/** The current user is an approver of the lesson at any level (so they may read it). */
const MY_LESSON = `EXISTS (SELECT 1 FROM lesson_upload_approvals a
   WHERE a.lesson_id = l.id AND (
        (a.kind = 'employee' AND a.approver_employee_id IN (SELECT id FROM employees WHERE user_id = app.current_user_id()))
     OR (a.kind = 'role' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                      WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id()
                                        AND ur.revoked_at IS NULL AND r.code = a.role_code))))`;

const SELECT = `SELECT l.id::text, l.on_date::text, l.target_type, l.topic, l.description, l.file_ids, l.status, l.current_level, l.levels,
       l.rule_scope, l.created_at, l.decided_at, l.deleted_at, l.employee_id::text,
       e.display_name AS employee, e.employee_code, COALESCE(e.department, '') AS department, e.user_id = app.current_user_id() AS mine,
       (SELECT string_agg(COALESCE(k.code, k2.code || '-' || cs.name), ', ' ORDER BY COALESCE(k.display_order, k2.display_order), cs.name)
          FROM lesson_upload_targets t LEFT JOIN classes k ON k.id = t.class_id
          LEFT JOIN class_sections cs ON cs.id = t.class_section_id LEFT JOIN classes k2 ON k2.id = cs.class_id
         WHERE t.lesson_id = l.id) AS classes,
       (SELECT COALESCE(ae.display_name, r.name, a.role_code)
          FROM lesson_upload_approvals a LEFT JOIN employees ae ON ae.id = a.approver_employee_id
          LEFT JOIN LATERAL (SELECT name FROM roles WHERE code = a.role_code ORDER BY school_id NULLS LAST LIMIT 1) r ON true
         WHERE a.lesson_id = l.id AND a.level = l.current_level) AS approver,
       ${MY_TURN} AS my_turn
  FROM lesson_uploads l JOIN employees e ON e.id = l.employee_id`;

export interface LessonRow {
  id: string;
  date: string;
  targetType: 'class' | 'section';
  classes: string;
  topic: string;
  employeeId: string;
  employee: string;
  employeeCode: string;
  department: string;
  status: 'pending' | 'acknowledged' | 'rejected';
  currentLevel: number;
  levels: number;
  /** Who it waits for while pending. */
  approver: string | null;
  requestedAt: string;
  decidedAt: string | null;
  files: number;
  mine: boolean;
  /** The signed-in user may acknowledge or reject it now. */
  myTurn: boolean;
  deleted: boolean;
}

const toRow = (x: Record<string, unknown>): LessonRow => ({
  id: String(x.id),
  date: String(x.on_date),
  targetType: x.target_type as 'class' | 'section',
  classes: (x.classes as string | null) ?? '',
  topic: String(x.topic),
  employeeId: String(x.employee_id),
  employee: String(x.employee),
  employeeCode: String(x.employee_code),
  department: String(x.department),
  status: x.status as LessonRow['status'],
  currentLevel: Number(x.current_level),
  levels: Number(x.levels),
  approver: x.status === 'pending' ? ((x.approver as string | null) ?? null) : null,
  requestedAt: (x.created_at as Date).toISOString(),
  decidedAt: x.decided_at ? (x.decided_at as Date).toISOString() : null,
  files: ((x.file_ids as unknown[]) ?? []).length,
  mine: Boolean(x.mine),
  myTurn: Boolean(x.my_turn),
  deleted: x.deleted_at !== null,
});

const istDay = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const shift = (date: string, by: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);

/**
 * The lesson planner as the school runs it (0097): a teacher uploads a lesson for a date and classes
 * (topic, description, attachments); it waits level by level for the approvers set for that teacher,
 * the class or the department, and ends acknowledged or rejected.
 */
@Injectable()
export class LessonUploadsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly files: FilesService,
  ) {}

  private year(ctx: RequestContext): string {
    const id = requireTenant(ctx).academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  private office(ctx: RequestContext): boolean {
    return ctx.permissions?.has(SETUP) === true;
  }

  /** The classes and sections the caller uploads for: a teacher their own, the office all. */
  async options(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    const allowed = await this.scopes.filter(tenant, MANAGE, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        section: string;
        class_id: string;
        code: string;
        name: string;
      }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS section, k.id::text AS class_id, k.code, k.name
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
          ORDER BY k.display_order, k.code, cs.name`,
        [yearId, allowed],
      );
      return {
        classes: [...new Map(r.rows.map((x) => [x.class_id, x.code])).entries()].map(
          ([value, label]) => ({ value, label }),
        ),
        sections: r.rows.map((x) => ({ value: x.id, label: x.section })),
        maxFiles: 2,
      };
    });
  }

  private async me(c: PoolClient) {
    const r = await c.query<{ id: string; department: string | null }>(
      `SELECT id::text, department FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    if (!r.rows[0])
      throw new DomainError(
        'planner.not_staff',
        'Your sign-in is not linked to an employee record; only employees upload lessons',
        { status: 409 },
      );
    return r.rows[0];
  }

  /** The approver levels for a lesson: the teacher's own rule, else a class's, else the department's, else the default. */
  private async levelsFor(
    c: PoolClient,
    employeeId: string,
    department: string | null,
    classIds: string[],
  ) {
    const r = await c.query<{ id: string; scope: string }>(
      `SELECT r.id::text, r.scope FROM lesson_approver_rules r
        WHERE (r.scope = 'employee' AND r.employee_id = $1)
           OR (r.scope = 'class' AND r.class_id = ANY($2::bigint[]))
           OR (r.scope = 'department' AND $3::text IS NOT NULL AND lower(r.department) = lower($3))
           OR r.scope = 'default'
        ORDER BY CASE r.scope WHEN 'employee' THEN 1 WHEN 'class' THEN 2 WHEN 'department' THEN 3 ELSE 4 END, r.id
        LIMIT 1`,
      [employeeId, classIds, department],
    );
    const rule = r.rows[0];
    if (!rule)
      // nothing is set up: the principal / school admin acknowledges
      return {
        scope: 'none',
        levels: [{ level: 1, kind: 'role', approver_employee_id: null, role_code: 'school_admin' }],
      };
    const l = await c.query<{
      level: number;
      kind: string;
      approver_employee_id: string | null;
      role_code: string | null;
    }>(
      `SELECT level, kind, approver_employee_id::text, role_code FROM lesson_approver_levels WHERE rule_id = $1 ORDER BY level`,
      [rule.id],
    );
    return { scope: rule.scope, levels: l.rows.map((x, i) => ({ ...x, level: i + 1 })) };
  }

  async create(ctx: RequestContext, dto: LessonUploadDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    const allowed = await this.scopes.filter(tenant, MANAGE, 'class_section');
    for (const id of new Set(dto.fileIds)) {
      const f = await this.files.get(ctx, id);
      if (f.status !== 'ready')
        throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
          status: 409,
        });
    }
    return this.db.tenant(tenant, async (c) => {
      const me = await this.me(c);
      const picked = dto.targetType === 'class' ? dto.classIds : dto.sectionIds;
      if (!picked.length)
        throw new DomainError('validation-failed', 'Choose at least one class', { status: 400 });
      // the classes behind the choice, and (for a teacher) only classes they teach
      const ok = await c.query<{ class_id: string }>(
        dto.targetType === 'class'
          ? `SELECT DISTINCT cs.class_id::text FROM class_sections cs
              WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND cs.class_id = ANY($2::bigint[])
                AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))`
          : `SELECT cs.class_id::text FROM class_sections cs
              WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL AND cs.id = ANY($2::bigint[])
                AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))`,
        [yearId, picked, allowed],
      );
      const expected = new Set(picked).size;
      if (
        (dto.targetType === 'class'
          ? new Set(ok.rows.map((x) => x.class_id)).size
          : ok.rows.length) !== expected
      )
        throw new DomainError('scope-denied', 'A chosen class is not assigned to you', {
          status: 403,
        });
      const classIds = [...new Set(ok.rows.map((x) => x.class_id))];
      const plan = await this.levelsFor(c, me.id, me.department, classIds);
      const ins = await c.query<{ id: string }>(
        `INSERT INTO lesson_uploads (school_id, academic_year_id, employee_id, on_date, target_type, topic, description, file_ids, levels, rule_scope, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7::jsonb, $8, $9, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          me.id,
          dto.date,
          dto.targetType,
          dto.topic,
          dto.description ? sanitizeEmailHtml(dto.description).trim() || null : null,
          JSON.stringify([...new Set(dto.fileIds)]),
          plan.levels.length,
          plan.scope,
        ],
      );
      const id = ins.rows[0]!.id;
      for (const t of new Set(picked))
        await c.query(
          `INSERT INTO lesson_upload_targets (school_id, lesson_id, class_id, class_section_id)
           VALUES (app.current_school_id(), $1, $2, $3)`,
          [id, dto.targetType === 'class' ? t : null, dto.targetType === 'section' ? t : null],
        );
      for (const l of plan.levels)
        await c.query(
          `INSERT INTO lesson_upload_approvals (school_id, lesson_id, level, kind, approver_employee_id, role_code)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [id, l.level, l.kind, l.approver_employee_id, l.role_code],
        );
      await this.audit.stage(ctx, c, {
        action: 'planner.lesson.upload',
        entityType: 'lesson_uploads',
        entityId: id,
        after: { date: dto.date, topic: dto.topic, levels: plan.levels.length, rule: plan.scope },
      });
      return this.detailIn(c, ctx, id);
    });
  }

  /** What the caller may read: the office everything; anyone else their own and those they approve. */
  private scopeSql(ctx: RequestContext): string {
    return this.office(ctx) ? 'TRUE' : `(e.user_id = app.current_user_id() OR ${MY_LESSON})`;
  }

  private where(ctx: RequestContext, q: LessonListDto, params: unknown[], withStatus = true) {
    const w = ['l.academic_year_id = $1', this.scopeSql(ctx)];
    w.push(q.record === 'deleted' ? 'l.deleted_at IS NOT NULL' : 'l.deleted_at IS NULL');
    if (q.from) {
      params.push(q.from);
      w.push(`(l.created_at AT TIME ZONE 'Asia/Kolkata')::date >= $${String(params.length)}::date`);
    }
    if (q.to) {
      params.push(q.to);
      w.push(`(l.created_at AT TIME ZONE 'Asia/Kolkata')::date <= $${String(params.length)}::date`);
    }
    if (q.level) {
      params.push(q.level);
      w.push(`l.status = 'pending' AND l.current_level = $${String(params.length)}`);
    }
    if (q.mine === 'approve') w.push(MY_TURN);
    if (q.mine === 'own') w.push('e.user_id = app.current_user_id()');
    if (q.q) {
      params.push(`%${q.q}%`);
      const p = `$${String(params.length)}`;
      w.push(
        q.by === 'employee_code'
          ? `e.employee_code ILIKE ${p}`
          : q.by === 'employee'
            ? `e.display_name ILIKE ${p}`
            : q.by === 'topic'
              ? `l.topic ILIKE ${p}`
              : q.by === 'class'
                ? `EXISTS (SELECT 1 FROM lesson_upload_targets t LEFT JOIN classes k ON k.id = t.class_id
                            LEFT JOIN class_sections cs ON cs.id = t.class_section_id LEFT JOIN classes k2 ON k2.id = cs.class_id
                           WHERE t.lesson_id = l.id AND COALESCE(k.code, k2.code || '-' || cs.name) ILIKE ${p})`
                : `(e.employee_code ILIKE ${p} OR e.display_name ILIKE ${p} OR l.topic ILIKE ${p})`,
      );
    }
    if (withStatus && q.status) {
      params.push(q.status);
      w.push(`l.status = $${String(params.length)}`);
    }
    return w.join(' AND ');
  }

  async list(ctx: RequestContext, q: LessonListDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cp: unknown[] = [yearId];
      const counted = this.where(ctx, q, cp, false);
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT l.status, count(*)::int AS n FROM lesson_uploads l JOIN employees e ON e.id = l.employee_id WHERE ${counted} GROUP BY 1`,
        cp,
      );
      const n = (s: string) => counts.rows.find((x) => x.status === s)?.n ?? 0;
      const params: unknown[] = [yearId];
      const where = this.where(ctx, q, params);
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        `${SELECT} WHERE ${where} ORDER BY l.id DESC LIMIT $${String(params.length - 1)} OFFSET $${String(params.length)}`,
        params,
      );
      const total = n('pending') + n('acknowledged') + n('rejected');
      return {
        data: r.rows.map(toRow),
        counts: {
          total,
          pending: n('pending'),
          acknowledged: n('acknowledged'),
          rejected: n('rejected'),
        },
        page: { number: q.page, size: q.size, total: q.status ? n(q.status) : total },
        office: this.office(ctx),
      };
    });
  }

  private async detailIn(c: PoolClient, ctx: RequestContext, id: string) {
    const r = await c.query<Record<string, unknown>>(
      `${SELECT} WHERE l.id = $1 AND ${this.scopeSql(ctx)}`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Lesson not found', { status: 404 });
    const a = await c.query<Record<string, unknown>>(
      `SELECT a.level, a.kind, a.state, a.remark, a.acted_at, COALESCE(ae.display_name, r.name, a.role_code) AS approver,
              (SELECT display_name FROM users WHERE id = a.acted_by) AS acted_by
         FROM lesson_upload_approvals a LEFT JOIN employees ae ON ae.id = a.approver_employee_id
         LEFT JOIN LATERAL (SELECT name FROM roles WHERE code = a.role_code ORDER BY school_id NULLS LAST LIMIT 1) r ON true
        WHERE a.lesson_id = $1 ORDER BY a.level`,
      [id],
    );
    return {
      ...toRow(x),
      description: (x.description as string | null) ?? null,
      fileIds: ((x.file_ids as unknown[]) ?? []).map(String),
      ruleScope: (x.rule_scope as string | null) ?? null,
      approvals: a.rows.map((y) => ({
        level: Number(y.level),
        approver: String(y.approver ?? ''),
        byRole: y.kind === 'role',
        state: y.state as 'pending' | 'acknowledged' | 'rejected',
        remark: (y.remark as string | null) ?? null,
        actedBy: (y.acted_by as string | null) ?? null,
        actedAt: y.acted_at ? (y.acted_at as Date).toISOString() : null,
      })),
    };
  }

  get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.detailIn(c, ctx, id));
  }

  async fileUrl(ctx: RequestContext, id: string, fileId: string) {
    const d = await this.get(ctx, id);
    if (!d.fileIds.includes(fileId))
      throw new DomainError('not-found', 'File not found', { status: 404 });
    return this.files.downloadUrl(ctx, fileId);
  }

  /** Acknowledge at my level (the lesson moves on, or is acknowledged), or reject it with a remark. */
  async decide(ctx: RequestContext, id: string, dto: LessonDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        current_level: number;
        levels: number;
        my_turn: boolean;
        status: string;
      }>(
        `SELECT l.current_level, l.levels, l.status, ${MY_TURN} AS my_turn FROM lesson_uploads l WHERE l.id = $1 AND l.deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      const l = r.rows[0];
      if (!l) throw new DomainError('not-found', 'Lesson not found', { status: 404 });
      if (l.status !== 'pending')
        throw new DomainError('planner.decided', 'This lesson is already decided', { status: 409 });
      if (!l.my_turn)
        throw new DomainError('planner.not_your_turn', 'This lesson is not waiting for you', {
          status: 403,
        });
      const state = dto.action === 'reject' ? 'rejected' : 'acknowledged';
      await c.query(
        `UPDATE lesson_upload_approvals SET state = $3, remark = $4, acted_by = app.current_user_id(), acted_at = now()
          WHERE lesson_id = $1 AND level = $2`,
        [id, l.current_level, state, dto.remark ?? null],
      );
      const last = dto.action === 'reject' || l.current_level >= l.levels;
      await c.query(
        `UPDATE lesson_uploads SET status = $2, current_level = $3, decided_at = CASE WHEN $4 THEN now() ELSE NULL END WHERE id = $1`,
        [
          id,
          dto.action === 'reject' ? 'rejected' : last ? 'acknowledged' : 'pending',
          last ? l.current_level : l.current_level + 1,
          last,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: `planner.lesson.${state}`,
        entityType: 'lesson_uploads',
        entityId: id,
        after: { level: l.current_level, remark: dto.remark ?? null },
      });
      return this.detailIn(c, ctx, id);
    });
  }

  /** The teacher removes their own lesson before anyone acted; the office any. It stays under "Deleted". */
  async remove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ mine: boolean; acted: boolean }>(
        `SELECT e.user_id = app.current_user_id() AS mine,
                EXISTS (SELECT 1 FROM lesson_upload_approvals a WHERE a.lesson_id = l.id AND a.state <> 'pending') AS acted
           FROM lesson_uploads l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [id],
      );
      const x = r.rows[0];
      if (!x) throw new DomainError('not-found', 'Lesson not found', { status: 404 });
      if (!this.office(ctx) && !(x.mine && !x.acted))
        throw new DomainError(
          'planner.locked',
          'Only your own lesson that nobody has acted on can be deleted',
          { status: 403 },
        );
      await c.query(
        `UPDATE lesson_uploads SET deleted_at = now(), deleted_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'planner.lesson.delete',
        entityType: 'lesson_uploads',
        entityId: id,
      });
      return { removed: true };
    });
  }

  async exportFile(ctx: RequestContext, q: LessonListDto, format: 'xlsx' | 'pdf') {
    const { data } = await this.list(ctx, { ...q, page: 1, size: 1000 });
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const STATUS = { pending: 'Pending', acknowledged: 'Acknowledged', rejected: 'Rejected' };
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Lesson report',
        details: [
          q.status ? STATUS[q.status] : 'All statuses',
          q.from || q.to ? `Requested from ${q.from ?? '…'} to ${q.to ?? '…'}` : '',
          q.q ? `Search: ${q.q}` : '',
          generatedOn(),
        ].filter(Boolean),
        legend: `${String(data.length)} lesson(s)`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Request', width: 5 },
          { label: 'Emp. code', width: 7 },
          { label: 'Employee', width: 14 },
          { label: 'Department', width: 9 },
          { label: 'Class', width: 9 },
          { label: 'Topic', width: 20 },
          { label: 'Lesson date', width: 7 },
          { label: 'Requested', width: 7 },
          { label: 'Status', width: 8 },
          { label: 'Current approver', width: 14 },
        ],
        rows: data.map((r, i) => [
          i + 1,
          `#${r.id}`,
          r.employeeCode,
          r.employee,
          r.department,
          r.classes,
          r.topic,
          r.date,
          r.requestedAt.slice(0, 10),
          STATUS[r.status],
          r.status === 'pending'
            ? `Level ${String(r.currentLevel)}: ${r.approver ?? 'not set'}`
            : '',
        ]),
        filename: `lesson-report-${istDay()}`,
      },
      format,
    );
  }

  // ---- who approves ----------------------------------------------------------------------------------
  async rules(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT r.id::text, r.scope, r.employee_id::text, e.display_name AS employee, e.employee_code, r.class_id::text, k.name AS class_name, r.department,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('level', l.level, 'kind', l.kind, 'employeeId', l.approver_employee_id::text,
                            'roleCode', l.role_code, 'label', COALESCE(ae.display_name, ro.name, l.role_code)) ORDER BY l.level)
                            FROM lesson_approver_levels l LEFT JOIN employees ae ON ae.id = l.approver_employee_id
                            LEFT JOIN LATERAL (SELECT name FROM roles WHERE code = l.role_code ORDER BY school_id NULLS LAST LIMIT 1) ro ON true
                           WHERE l.rule_id = r.id), '[]'::jsonb) AS levels
           FROM lesson_approver_rules r LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN classes k ON k.id = r.class_id
          ORDER BY CASE r.scope WHEN 'default' THEN 0 WHEN 'department' THEN 1 WHEN 'class' THEN 2 ELSE 3 END, k.display_order, r.department, e.display_name`,
      );
      const employees = await c.query<{ value: string; label: string }>(
        `SELECT id::text AS value, display_name || ' (' || employee_code || ')' AS label FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 1000`,
      );
      const classes = await c.query<{ value: string; label: string }>(
        `SELECT id::text AS value, name AS label FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code`,
      );
      const departments = await c.query<{ d: string }>(
        `SELECT DISTINCT department AS d FROM employees WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> '' ORDER BY 1`,
      );
      const roles = await c.query<{ value: string; label: string }>(
        `SELECT DISTINCT ON (code) code AS value, name AS label FROM roles
          WHERE deleted_at IS NULL AND (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'erp_support', 'support_engineer', 'auditor')
          ORDER BY code, school_id NULLS LAST`,
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          scope: x.scope as 'employee' | 'class' | 'department' | 'default',
          employeeId: (x.employee_id as string | null) ?? null,
          classId: (x.class_id as string | null) ?? null,
          department: (x.department as string | null) ?? null,
          label:
            x.scope === 'employee'
              ? `${String(x.employee)} (${String(x.employee_code)})`
              : x.scope === 'class'
                ? String(x.class_name)
                : x.scope === 'department'
                  ? String(x.department)
                  : 'Everyone else (school default)',
          levels: x.levels as Array<{
            level: number;
            kind: 'employee' | 'role';
            employeeId: string | null;
            roleCode: string | null;
            label: string;
          }>,
        })),
        employees: employees.rows,
        classes: classes.rows,
        departments: departments.rows.map((x) => x.d),
        roles: roles.rows,
      };
    });
  }

  /** One rule per employee, class, department, and one default: saving again replaces its levels. */
  async saveRule(ctx: RequestContext, dto: LessonRuleDto) {
    const key =
      dto.scope === 'employee'
        ? dto.employeeId
        : dto.scope === 'class'
          ? dto.classId
          : dto.department;
    if (dto.scope !== 'default' && !key)
      throw new DomainError(
        'validation-failed',
        dto.scope === 'employee'
          ? 'Choose the employee'
          : dto.scope === 'class'
            ? 'Choose the class'
            : 'Choose the department',
        { status: 400 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `DELETE FROM lesson_approver_rules WHERE scope = $1 AND COALESCE(employee_id, 0) = COALESCE($2::bigint, 0)
            AND COALESCE(class_id, 0) = COALESCE($3::bigint, 0) AND COALESCE(lower(department), '') = COALESCE(lower($4), '')`,
        [
          dto.scope,
          dto.scope === 'employee' ? dto.employeeId : null,
          dto.scope === 'class' ? dto.classId : null,
          dto.scope === 'department' ? dto.department : null,
        ],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO lesson_approver_rules (school_id, scope, employee_id, class_id, department, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id()) RETURNING id::text`,
        [
          dto.scope,
          dto.scope === 'employee' ? dto.employeeId : null,
          dto.scope === 'class' ? dto.classId : null,
          dto.scope === 'department' ? dto.department : null,
        ],
      );
      let level = 0;
      for (const l of dto.levels) {
        level += 1;
        await c.query(
          `INSERT INTO lesson_approver_levels (school_id, rule_id, level, kind, approver_employee_id, role_code)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [
            r.rows[0]!.id,
            level,
            l.kind,
            l.kind === 'employee' ? l.employeeId : null,
            l.kind === 'role' ? l.roleCode : null,
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'planner.lesson.approvers',
        entityType: 'lesson_approver_rules',
        entityId: r.rows[0]!.id,
        after: { scope: dto.scope, levels: dto.levels.length },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removeRule(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`DELETE FROM lesson_approver_rules WHERE id = $1`, [id]);
      return { removed: true };
    });
  }

  // ---- dashboard -------------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext, q: LessonRangeDto) {
    const yearId = this.year(ctx);
    const to = q.to ?? istDay();
    const from = q.from ?? shift(to, -29);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const base = `FROM lesson_uploads l JOIN employees e ON e.id = l.employee_id
        WHERE l.academic_year_id = $1 AND l.deleted_at IS NULL
          AND (l.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date`;
      const p = [yearId, from, to];
      const rows = async <T extends Record<string, unknown>>(sql: string) =>
        (await c.query<T>(sql, p)).rows;
      const status = await rows<{ status: string; n: number }>(
        `SELECT l.status, count(*)::int AS n ${base} GROUP BY 1`,
      );
      const levels = await rows<{ level: number; n: number }>(
        `SELECT l.current_level AS level, count(*)::int AS n ${base} AND l.status = 'pending' GROUP BY 1 ORDER BY 1`,
      );
      const approvers = await rows<{ approver: string; n: number; oldest: string }>(
        `SELECT COALESCE(ae.display_name, r.name, a.role_code, 'Not set') AS approver, count(*)::int AS n,
                min((l.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS oldest
           ${base.replace(
             'WHERE',
             `JOIN lesson_upload_approvals a ON a.lesson_id = l.id AND a.level = l.current_level
           LEFT JOIN employees ae ON ae.id = a.approver_employee_id
           LEFT JOIN LATERAL (SELECT name FROM roles WHERE code = a.role_code ORDER BY school_id NULLS LAST LIMIT 1) r ON true
          WHERE`,
           )} AND l.status = 'pending' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      );
      const departments = await rows<{ label: string; n: number; pending: number }>(
        `SELECT COALESCE(NULLIF(e.department, ''), 'No department') AS label, count(*)::int AS n,
                count(*) FILTER (WHERE l.status = 'pending')::int AS pending ${base} GROUP BY 1 ORDER BY 2 DESC`,
      );
      const classes = await rows<{ label: string; n: number }>(
        `SELECT COALESCE(k.code, k2.code) AS label, count(DISTINCT l.id)::int AS n
           ${base.replace(
             'WHERE',
             `JOIN lesson_upload_targets t ON t.lesson_id = l.id
           LEFT JOIN classes k ON k.id = t.class_id LEFT JOIN class_sections cs ON cs.id = t.class_section_id
           LEFT JOIN classes k2 ON k2.id = cs.class_id
          WHERE`,
           )} GROUP BY 1, COALESCE(k.display_order, k2.display_order) ORDER BY COALESCE(k.display_order, k2.display_order)`,
      );
      const people = await rows<{
        label: string;
        n: number;
        acknowledged: number;
        rejected: number;
      }>(
        `SELECT e.display_name AS label, count(*)::int AS n, count(*) FILTER (WHERE l.status = 'acknowledged')::int AS acknowledged,
                count(*) FILTER (WHERE l.status = 'rejected')::int AS rejected ${base} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
      );
      const days = await rows<{ d: string; n: number }>(
        `SELECT (l.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS d, count(*)::int AS n ${base} GROUP BY 1 ORDER BY 1 DESC LIMIT 14`,
      );
      // teachers (anyone with a class assigned) who uploaded nothing in these dates
      const silent = await rows<{ name: string; code: string; department: string }>(
        `SELECT e.display_name AS name, e.employee_code AS code, COALESCE(e.department, '') AS department
           FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active'
            AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = e.id AND ta.academic_year_id = $1 AND ta.valid_to IS NULL)
            AND NOT EXISTS (SELECT 1 FROM lesson_uploads l WHERE l.employee_id = e.id AND l.academic_year_id = $1 AND l.deleted_at IS NULL
                             AND (l.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date)
          ORDER BY e.display_name`,
      );
      const n = (s: string) => status.find((x) => x.status === s)?.n ?? 0;
      return {
        from,
        to,
        kpis: {
          total: n('pending') + n('acknowledged') + n('rejected'),
          pending: n('pending'),
          acknowledged: n('acknowledged'),
          rejected: n('rejected'),
          notUploaded: silent.length,
        },
        pendingByLevel: levels,
        pendingByApprover: approvers,
        byDepartment: departments,
        byClass: classes,
        byEmployee: people,
        trend: days.reverse(),
        notUploaded: silent.slice(0, 40),
      };
    });
  }
}
