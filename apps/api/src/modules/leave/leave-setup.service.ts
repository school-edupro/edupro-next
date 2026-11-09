import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { buildLevels, setupLists, toSetup } from '../people/approval-levels';
import { WorkflowService } from '../workflow/workflow.service';
import { bandOf, chainFor, emptyBands, type StoredBand } from './leave-chain';
import {
  BANDS,
  LEAVE,
  REG_BAND,
  type ApprovalRuleDto,
  type BandLevelsDto,
  type ChainPreviewDto,
  type LeaveSettingsDto,
  type RuleStatusDto,
  type Scope,
} from './leave.dto';

const SCOPE_WORDS: Record<Scope, string> = {
  all: 'All staff',
  department: 'Department',
  designation: 'Designation',
  employee_type: 'Employee type',
  employee: 'Employee',
};

interface RuleRow {
  id: string;
  kind: 'leave' | 'regularisation';
  name: string;
  scope: Scope;
  scope_values: string[];
  leave_type_id: string | null;
  type_code: string | null;
  type_name: string | null;
  bands: StoredBand[];
  priority: number;
  status: 'active' | 'inactive';
}

const RULE = `SELECT r.id::text, r.kind, r.name, r.scope, r.scope_values, r.leave_type_id::text, t.code AS type_code,
                     t.name AS type_name, r.bands, r.priority, r.status
                FROM staff_leave_approval_rules r LEFT JOIN staff_leave_types t ON t.id = r.leave_type_id`;

/**
 * Staff leave and attendance set-up (docs/design/85, phase A): the overview with what is missing or would
 * misbehave, who approves (rules by scope and leave type, three day bands of up to 3 levels; the
 * regularisation chain) with a test of the chain for an employee, and the settings. The leave types,
 * policies, weekly offs, shifts and shift postings are masters (Leave & attendance setup grids).
 */
@Injectable()
export class LeaveSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private mustView(ctx: RequestContext) {
    if (!this.has(ctx, LEAVE.setupView) && !this.has(ctx, LEAVE.setupManage))
      throw new DomainError('permission-denied', 'Only the leave office sees the set-up', {
        status: 403,
      });
  }
  private mustManage(ctx: RequestContext) {
    if (!this.has(ctx, LEAVE.setupManage))
      throw new DomainError('permission-denied', 'Only the leave office changes the set-up', {
        status: 403,
      });
  }

  // ---- overview ------------------------------------------------------------------------------------
  /**
   * The counts of each part, and what is missing or would misbehave (as the earlier module warned): no
   * loss-of-pay type or more than one, a type ordered after loss of pay (never reached), two types in the
   * same deduction order, a type with a balance and no policy, staff no policy takes in, staff with no
   * approver, no regularisation chain, no default shift.
   */
  async overview(ctx: RequestContext) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed(app.current_school_id())`);
      const types = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          keeps_balance: boolean;
          loss_of_pay: boolean;
          auto_approve: boolean;
          deduct_order: number | null;
          policies: number;
          uncovered: number;
        }>(
          `SELECT t.id::text, t.code, t.name, t.keeps_balance, t.loss_of_pay, t.auto_approve, t.deduct_order,
                  (SELECT count(*)::int FROM staff_leave_policies p WHERE p.leave_type_id = t.id AND p.status = 'active') AS policies,
                  (SELECT count(*)::int FROM employees e
                    WHERE e.deleted_at IS NULL AND e.status = 'active'
                      AND NOT EXISTS (SELECT 1 FROM staff_leave_policies p WHERE p.leave_type_id = t.id AND p.status = 'active'
                                        AND app.staff_in_scope(p.scope, p.scope_values, e.id))) AS uncovered
             FROM staff_leave_types t WHERE t.status = 'active' ORDER BY t.sort_order, t.code`,
        )
      ).rows;
      const n = (
        await c.query<{
          policies: number;
          weekoffs: number;
          shifts: number;
          postings: number;
          leave_rules: number;
          reg_rules: number;
          staff: number;
          no_approver: number;
          holidays: number;
          default_shift: boolean;
        }>(
          `SELECT (SELECT count(*)::int FROM staff_leave_policies WHERE status = 'active') AS policies,
                  (SELECT count(*)::int FROM staff_weekoff_rules WHERE status = 'active') AS weekoffs,
                  (SELECT count(*)::int FROM staff_shifts WHERE status = 'active') AS shifts,
                  (SELECT count(*)::int FROM staff_shift_postings WHERE status = 'active') AS postings,
                  (SELECT count(*)::int FROM staff_leave_approval_rules WHERE status = 'active' AND kind = 'leave') AS leave_rules,
                  (SELECT count(*)::int FROM staff_leave_approval_rules WHERE status = 'active' AND kind = 'regularisation') AS reg_rules,
                  (SELECT count(*)::int FROM employees WHERE deleted_at IS NULL AND status = 'active') AS staff,
                  (SELECT count(*)::int FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active'
                     AND NOT EXISTS (SELECT 1 FROM staff_leave_approval_rules r
                                      WHERE r.status = 'active' AND r.kind = 'leave'
                                        AND jsonb_array_length(COALESCE(r.bands -> 0 -> 'levels', '[]'::jsonb)) > 0
                                        AND app.staff_in_scope(r.scope, r.scope_values, e.id))) AS no_approver,
                  (SELECT count(*)::int FROM holidays h WHERE h.applies_to IN ('everyone', 'employees')
                     AND h.kind IN ('holiday', 'vacation') AND h.ends_on >= (now() AT TIME ZONE 'Asia/Kolkata')::date) AS holidays,
                  EXISTS (SELECT 1 FROM staff_leave_settings s JOIN staff_shifts h ON h.id = s.default_shift_id AND h.status = 'active') AS default_shift`,
        )
      ).rows[0]!;
      const warnings: string[] = [];
      const lop = types.filter((t) => t.loss_of_pay);
      if (!lop.length)
        warnings.push(
          'There is no loss-of-pay type: leave short of balance and absence with no application have nowhere to go. Add one (Loss of pay = yes).',
        );
      if (lop.length > 1)
        warnings.push(
          `More than one loss-of-pay type (${lop.map((t) => t.code).join(', ')}): the first in the deduction order is used.`,
        );
      const lopOrder = lop[0]?.deduct_order ?? null;
      if (lop.length && lopOrder === null)
        warnings.push(
          `${lop[0]!.code} has no deduction order: the automatic deduction never reaches it. Give it the highest number (999).`,
        );
      if (lopOrder !== null) {
        const after = types.filter(
          (t) => !t.loss_of_pay && t.deduct_order !== null && t.deduct_order > lopOrder,
        );
        if (after.length)
          warnings.push(
            `${after.map((t) => t.code).join(', ')} come after loss of pay in the deduction order, so they are never taken automatically.`,
          );
      }
      const orders = new Map<number, string[]>();
      for (const t of types)
        if (t.deduct_order !== null)
          orders.set(t.deduct_order, [...(orders.get(t.deduct_order) ?? []), t.code]);
      for (const [o, codes] of orders)
        if (codes.length > 1)
          warnings.push(
            `${codes.join(' and ')} share deduction order ${String(o)}: give each its own number.`,
          );
      const noPolicy = types.filter((t) => t.keeps_balance && !t.loss_of_pay && !t.policies);
      if (noPolicy.length)
        warnings.push(
          `${noPolicy.map((t) => t.code).join(', ')} keep a balance but have no policy: nobody is credited. Add a policy (Leave policies).`,
        );
      const partly = types.filter(
        (t) => t.keeps_balance && !t.loss_of_pay && t.policies && t.uncovered,
      );
      for (const t of partly)
        warnings.push(
          `${String(t.uncovered)} of ${String(n.staff)} staff are in no ${t.code} policy, so they get no ${t.code}.`,
        );
      if (n.no_approver)
        warnings.push(
          `${String(n.no_approver)} of ${String(n.staff)} staff have no approver for leave: they cannot apply (types approved at once excepted). Add a rule on Who approves.`,
        );
      if (!n.reg_rules)
        warnings.push(
          'No approver is set for attendance corrections (regularisation): add a regularisation rule on Who approves.',
        );
      if (!n.default_shift)
        warnings.push('No default shift: staff with no shift posting have no working hours.');
      return {
        counts: {
          types: types.length,
          policies: n.policies,
          weekoffs: n.weekoffs,
          shifts: n.shifts,
          postings: n.postings,
          leaveRules: n.leave_rules,
          regRules: n.reg_rules,
          staff: n.staff,
          noApprover: n.no_approver,
          holidays: n.holidays,
        },
        types: types.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          keepsBalance: t.keeps_balance,
          lossOfPay: t.loss_of_pay,
          autoApprove: t.auto_approve,
          deductOrder: t.deduct_order,
          policies: t.policies,
          uncovered: t.uncovered,
        })),
        warnings,
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  // ---- who approves --------------------------------------------------------------------------------
  private shape(r: RuleRow) {
    const labels = r.kind === 'regularisation' ? [REG_BAND.label] : BANDS.map((b) => b.label);
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      scope: r.scope,
      scopeWords:
        r.scope === 'all'
          ? SCOPE_WORDS.all
          : `${SCOPE_WORDS[r.scope]}: ${r.scope_values.join(', ')}`,
      scopeValues: r.scope_values,
      leaveType: r.leave_type_id
        ? { id: r.leave_type_id, code: r.type_code!, name: r.type_name! }
        : null,
      priority: r.priority,
      status: r.status,
      bands: labels.map((label, i) => ({
        label,
        levels: (r.bands[i]?.levels ?? []).map((l) => l.name),
      })),
    };
  }

  /** The values a scope may name: departments, designations, employee types, employee codes. */
  private async scopeLists(c: PoolClient) {
    const q = async (sql: string) => (await c.query<{ v: string }>(sql)).rows.map((x) => x.v);
    return {
      department: await q(
        `SELECT name AS v FROM departments WHERE status = 'active'
         UNION SELECT DISTINCT department FROM employees WHERE deleted_at IS NULL AND COALESCE(department, '') <> '' ORDER BY 1`,
      ),
      designation: await q(
        `SELECT name AS v FROM designations WHERE status = 'active'
         UNION SELECT DISTINCT designation FROM employees WHERE deleted_at IS NULL AND COALESCE(designation, '') <> '' ORDER BY 1`,
      ),
      employee_type: await q(
        `SELECT code AS v FROM employee_types WHERE status = 'active'
         UNION SELECT DISTINCT employee_type::text FROM employees WHERE deleted_at IS NULL AND employee_type IS NOT NULL ORDER BY 1`,
      ),
      employee: await q(
        `SELECT employee_code AS v FROM employees WHERE deleted_at IS NULL AND status = 'active'
            AND employee_code IS NOT NULL ORDER BY 1 LIMIT 5000`,
      ),
    };
  }

  /** The scope's values as typed, checked against the school's lists (the names as the lists spell them). */
  private async checkScope(c: PoolClient, scope: Scope, values: string[]) {
    if (scope === 'all') return [];
    const known = (await this.scopeLists(c))[scope];
    const map = new Map(known.map((k) => [k.toLowerCase(), k]));
    // a department or designation may be named by its code too
    if (scope === 'department' || scope === 'designation') {
      const r = await c.query<{ code: string; name: string }>(
        scope === 'department'
          ? `SELECT code, name FROM departments WHERE status = 'active'`
          : `SELECT code, name FROM designations WHERE status = 'active'`,
      );
      for (const x of r.rows)
        if (!map.has(x.code.toLowerCase())) map.set(x.code.toLowerCase(), x.name);
    }
    if (scope === 'employee_type') {
      const r = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM employee_types WHERE status = 'active'`,
      );
      for (const x of r.rows) map.set(x.name.toLowerCase(), x.code);
    }
    const out: string[] = [];
    const unknown: string[] = [];
    for (const v of values) {
      const hit = map.get(v.trim().toLowerCase());
      if (hit) {
        if (!out.includes(hit)) out.push(hit);
      } else unknown.push(v);
    }
    if (unknown.length)
      throw new DomainError(
        'validation-failed',
        `Not a ${SCOPE_WORDS[scope].toLowerCase()} of the school: ${unknown.join(', ')}`,
        { status: 400 },
      );
    return out;
  }

  async rules(ctx: RequestContext) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed(app.current_school_id())`);
      const rows = (
        await c.query<RuleRow>(
          // eslint-disable-next-line no-restricted-syntax -- RULE is a fixed fragment
          `${RULE} ORDER BY r.kind, (r.status = 'inactive'), r.priority, r.name`,
        )
      ).rows;
      const types = await c.query<{ id: string; code: string; name: string; auto: boolean }>(
        `SELECT id::text, code, name, auto_approve AS auto FROM staff_leave_types
          WHERE status = 'active' ORDER BY sort_order, code`,
      );
      const staff = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 5000`,
      );
      return {
        rules: rows.map((r) => this.shape(r)),
        types: types.rows,
        staff: staff.rows,
        scopes: await this.scopeLists(c),
        bands: BANDS.map((b) => b.label),
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  async rule(ctx: RequestContext, id: string) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<RuleRow>(
          // eslint-disable-next-line no-restricted-syntax -- RULE is a fixed fragment
          `${RULE} WHERE r.id = $1`,
          [id],
        )
      ).rows[0];
      if (!r) throw new DomainError('not-found', 'Rule not found', { status: 404 });
      const lists = await setupLists(c);
      const labels = r.kind === 'regularisation' ? [REG_BAND.label] : BANDS.map((b) => b.label);
      return {
        rule: this.shape(r),
        bands: labels.map((label, i) => ({
          index: i,
          label,
          levels: (r.bands[i]?.levels ?? []).map((l) => toSetup(l, lists.staffRows)),
        })),
        staff: lists.staff,
        designations: lists.designations,
        departments: lists.departments,
        roles: lists.roles,
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  private async typeOf(c: PoolClient, kind: string, leaveTypeId: string | null | undefined) {
    if (kind === 'regularisation' || !leaveTypeId) return null;
    const t = await c.query(`SELECT 1 FROM staff_leave_types WHERE id = $1 AND status = 'active'`, [
      leaveTypeId,
    ]);
    if (!t.rowCount)
      throw new DomainError('validation-failed', 'Pick an active leave type', { status: 400 });
    return leaveTypeId;
  }

  private clash(e: unknown): never {
    if ((e as { code?: string }).code === '23505')
      throw new DomainError(
        'validation-failed',
        'Another active rule is for the same staff and leave type: change that one, or switch it off first',
        { status: 409 },
      );
    throw e;
  }

  async createRule(ctx: RequestContext, dto: ApprovalRuleDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const values = await this.checkScope(c, dto.scope, dto.scopeValues);
      const typeId = await this.typeOf(c, dto.kind, dto.leaveTypeId);
      try {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO staff_leave_approval_rules (school_id, kind, name, scope, scope_values, leave_type_id, bands, priority, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, $7, app.current_user_id()) RETURNING id::text`,
            [
              dto.kind,
              dto.name,
              dto.scope,
              values,
              typeId,
              JSON.stringify(emptyBands(dto.kind)),
              dto.priority,
            ],
          )
        ).rows[0]!.id;
        await this.audit.stage(ctx, c, {
          action: 'leave.approval_rule.create',
          entityType: 'staff_leave_approval_rules',
          entityId: id,
          after: { name: dto.name, scope: dto.scope, values },
        });
        return { id };
      } catch (e) {
        this.clash(e);
      }
    });
  }

  async updateRule(ctx: RequestContext, id: string, dto: ApprovalRuleDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await c.query<{ kind: string }>(
        `SELECT kind FROM staff_leave_approval_rules WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur.rows[0]) throw new DomainError('not-found', 'Rule not found', { status: 404 });
      if (cur.rows[0].kind !== dto.kind)
        throw new DomainError(
          'validation-failed',
          'A leave rule stays a leave rule (and a regularisation rule a regularisation rule)',
          { status: 400 },
        );
      const values = await this.checkScope(c, dto.scope, dto.scopeValues);
      const typeId = await this.typeOf(c, dto.kind, dto.leaveTypeId);
      try {
        await c.query(
          `UPDATE staff_leave_approval_rules SET name = $2, scope = $3, scope_values = $4, leave_type_id = $5,
                  priority = $6, updated_at = now() WHERE id = $1`,
          [id, dto.name, dto.scope, values, typeId, dto.priority],
        );
      } catch (e) {
        this.clash(e);
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.approval_rule.update',
        entityType: 'staff_leave_approval_rules',
        entityId: id,
        after: { name: dto.name, scope: dto.scope, values },
      });
      return { id };
    });
  }

  /** One band's levels (up to 3): named staff, the reporting manager, the HOD, a designation or a role. */
  async setBand(ctx: RequestContext, id: string, band: number, dto: BandLevelsDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = (
        await c.query<{ kind: 'leave' | 'regularisation'; bands: StoredBand[] }>(
          `SELECT kind, bands FROM staff_leave_approval_rules WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!cur) throw new DomainError('not-found', 'Rule not found', { status: 404 });
      const count = cur.kind === 'regularisation' ? 1 : BANDS.length;
      if (!Number.isInteger(band) || band < 0 || band >= count)
        throw new DomainError('validation-failed', 'No such day band', { status: 400 });
      const levels = dto.levels.length
        ? await buildLevels(
            c,
            dto.levels.map((l) => ({
              name: l.name,
              by: l.by,
              employeeIds: l.employeeIds,
              ...(l.designation ? { designation: l.designation } : {}),
              ...(l.roleCode ? { roleCode: l.roleCode } : {}),
              slaHours: l.slaHours ?? null,
            })),
            { allowManager: true },
          )
        : [];
      const bands = cur.bands.length === count ? [...cur.bands] : emptyBands(cur.kind);
      bands[band] = { ...bands[band]!, levels };
      await c.query(
        `UPDATE staff_leave_approval_rules SET bands = $2::jsonb, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(bands)],
      );
      await this.audit.stage(ctx, c, {
        action: 'leave.approval_rule.levels',
        entityType: 'staff_leave_approval_rules',
        entityId: id,
        after: { band, levels: levels.map((l) => l.name) },
      });
      // nothing waits on a rule yet (phase B moves waiting leave to the new people)
      return { moved: 0, approved: 0 };
    });
  }

  async setStatus(ctx: RequestContext, id: string, dto: RuleStatusDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = await c.query(
          `UPDATE staff_leave_approval_rules SET status = $2, updated_at = now() WHERE id = $1`,
          [id, dto.status],
        );
        if (!r.rowCount) throw new DomainError('not-found', 'Rule not found', { status: 404 });
      } catch (e) {
        this.clash(e);
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.approval_rule.status',
        entityType: 'staff_leave_approval_rules',
        entityId: id,
        after: { status: dto.status },
      });
      return { id, status: dto.status };
    });
  }

  /**
   * Test the chain (the earlier module's "matrix test"): for an employee, a leave type and so many days,
   * the rule and band used and, level by level, who that is today — or why there is nobody.
   */
  async preview(ctx: RequestContext, dto: ChainPreviewDto) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = (
        await c.query<{
          id: string;
          name: string;
          department: string | null;
          user_id: string | null;
        }>(
          `SELECT id::text, display_name || ' (' || employee_code || ')' AS name, department, user_id::text
             FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [dto.employeeId],
        )
      ).rows[0];
      if (!e) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      const type = dto.leaveTypeId
        ? (
            await c.query<{ code: string; auto: boolean }>(
              `SELECT code, auto_approve AS auto FROM staff_leave_types WHERE id = $1`,
              [dto.leaveTypeId],
            )
          ).rows[0]
        : undefined;
      const band = bandOf(dto.kind, dto.days);
      const label = dto.kind === 'regularisation' ? REG_BAND.label : BANDS[band]!.label;
      if (dto.kind === 'leave' && type?.auto)
        return {
          employee: e.name,
          band: label,
          rule: null,
          levels: [],
          note: `${type.code} is approved at once: no approver is needed.`,
        };
      const chain = await chainFor(
        c,
        e.id,
        dto.kind,
        dto.kind === 'leave' ? (dto.leaveTypeId ?? null) : null,
        dto.days,
      );
      if (!chain)
        return {
          employee: e.name,
          band: label,
          rule: null,
          levels: [],
          note: 'No rule gives this employee an approver for that: the application would be refused. Add a rule, or levels in this band.',
        };
      const levels = [];
      for (const l of chain.levels) {
        const users = (
          await this.workflow.resolveAssignees(c, l.resolver, null, {
            department: e.department,
            employeeId: e.id,
          })
        ).filter((u) => u !== e.user_id);
        const names = users.length
          ? (
              await c.query<{ name: string }>(
                `SELECT COALESCE((SELECT x.display_name || ' (' || x.employee_code || ')' FROM employees x
                                   WHERE x.user_id = u.id AND x.deleted_at IS NULL LIMIT 1), u.display_name) AS name
                   FROM users u WHERE u.id = ANY($1::bigint[]) ORDER BY 1`,
                [users],
              )
            ).rows.map((x) => x.name)
          : [];
        levels.push({
          name: l.name,
          people: names,
          note: names.length
            ? null
            : 'Nobody holds this level for the employee (or only the employee): it is skipped.',
        });
      }
      return {
        employee: e.name,
        band: label,
        rule: { id: chain.ruleId, name: chain.rule },
        levels,
        note: levels.every((l) => !l.people.length)
          ? 'Every level is skipped: the application would be refused.'
          : null,
      };
    });
  }

  // ---- settings ------------------------------------------------------------------------------------
  async settings(ctx: RequestContext) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed(app.current_school_id())`);
      const s = (
        await c.query<{
          late_marks_per_leave: number;
          missing_punches_per_leave: number;
          lop_after_days: number;
          punch_gap_minutes: number;
          recheck_days: number;
          absent_lookback_days: number;
          exceptions_from: string | null;
          default_shift_id: string | null;
          late_reduces_hours: boolean;
          allow_time_edit: boolean;
          allow_on_behalf: boolean;
          backdate_days: number | null;
          missing_punch_cc: string | null;
          device_serials: string[];
          send_email: boolean;
          send_whatsapp: boolean;
          send_app: boolean;
          send_sms: boolean;
          updated_at: Date;
        }>(
          `SELECT late_marks_per_leave, missing_punches_per_leave, lop_after_days, punch_gap_minutes, recheck_days,
                  absent_lookback_days, exceptions_from::text, default_shift_id::text, late_reduces_hours, allow_time_edit,
                  allow_on_behalf, backdate_days, missing_punch_cc, device_serials, send_email, send_whatsapp, send_app,
                  send_sms, updated_at
             FROM staff_leave_settings`,
        )
      ).rows[0]!;
      const shifts = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM staff_shifts WHERE status = 'active' ORDER BY code`,
      );
      return {
        settings: {
          lateMarksPerLeave: s.late_marks_per_leave,
          missingPunchesPerLeave: s.missing_punches_per_leave,
          lopAfterDays: s.lop_after_days,
          punchGapMinutes: s.punch_gap_minutes,
          recheckDays: s.recheck_days,
          absentLookbackDays: s.absent_lookback_days,
          exceptionsFrom: s.exceptions_from,
          defaultShiftId: s.default_shift_id,
          lateReducesHours: s.late_reduces_hours,
          allowTimeEdit: s.allow_time_edit,
          allowOnBehalf: s.allow_on_behalf,
          backdateDays: s.backdate_days,
          missingPunchCc: s.missing_punch_cc,
          deviceSerials: s.device_serials,
          sendEmail: s.send_email,
          sendWhatsapp: s.send_whatsapp,
          sendApp: s.send_app,
          sendSms: s.send_sms,
          updatedAt: s.updated_at.toISOString(),
        },
        shifts: shifts.rows,
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: LeaveSettingsDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed(app.current_school_id())`);
      if (dto.defaultShiftId) {
        const ok = await c.query(`SELECT 1 FROM staff_shifts WHERE id = $1 AND status = 'active'`, [
          dto.defaultShiftId,
        ]);
        if (!ok.rowCount)
          throw new DomainError('validation-failed', 'Pick an active shift as the default', {
            status: 400,
          });
      }
      await c.query(
        `UPDATE staff_leave_settings SET late_marks_per_leave = $1, missing_punches_per_leave = $2, lop_after_days = $3,
                punch_gap_minutes = $4, recheck_days = $5, absent_lookback_days = $6, exceptions_from = $7::date,
                default_shift_id = $8::bigint, late_reduces_hours = $9, allow_time_edit = $10, allow_on_behalf = $11,
                backdate_days = $12, missing_punch_cc = $13, device_serials = $14, send_email = $15, send_whatsapp = $16,
                send_app = $17, send_sms = $18, updated_by = app.current_user_id(), updated_at = now()`,
        [
          dto.lateMarksPerLeave,
          dto.missingPunchesPerLeave,
          dto.lopAfterDays,
          dto.punchGapMinutes,
          dto.recheckDays,
          dto.absentLookbackDays,
          dto.exceptionsFrom,
          dto.defaultShiftId,
          dto.lateReducesHours,
          dto.allowTimeEdit,
          dto.allowOnBehalf,
          dto.backdateDays,
          dto.missingPunchCc || null,
          [...new Set(dto.deviceSerials)],
          dto.sendEmail,
          dto.sendWhatsapp,
          dto.sendApp,
          dto.sendSms,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'leave.settings.update',
        entityType: 'staff_leave_settings',
        entityId: '0',
        after: { ...dto },
      });
      return { saved: true };
    });
  }
}
