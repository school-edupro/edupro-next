import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { buildLevels, setupLists, toSetup } from '../people/approval-levels';
import { WorkflowService, type Level } from '../workflow/workflow.service';
import { bandOf, chainFor, emptyBands, type StoredBand } from './leave-chain';
import {
  BANDS,
  LEAVE,
  REG_BAND,
  type ApprovalRuleDto,
  type ApproversByEmployeeDto,
  type ApproversImportDto,
  type BandLevelsDto,
  type ChainPreviewDto,
  type LeaveSettingsDto,
  type MoveRuleDto,
  type OwnRuleDto,
  type RuleStatusDto,
  type Scope,
} from './leave.dto';

/** The approver sheet: four chains — three leave lengths and corrections — of up to 3 levels. */
const SHEET_CHAINS: Array<['leave' | 'regularisation', number]> = [
  ['leave', 0],
  ['leave', 1],
  ['leave', 2],
  ['regularisation', 0],
];
const SHEET_LABELS = ['Leave 0-7 days', 'Leave 7-30 days', 'Leave 30-365 days', 'Corrections'];
const SHEET_HEADS = SHEET_LABELS.flatMap((l) => [1, 2, 3].map((i) => `${l} L${String(i)}`));
interface SheetLevel {
  need: 'any' | 'all';
  codes: string[];
}
type SheetChain = SheetLevel[];
/** E003 · E003, E005 (any one) · E003 + E005 (all) */
const cellOf = (l: SheetLevel) => l.codes.join(l.need === 'all' ? ' + ' : ', ');
const keyOf = (levels: SheetLevel[]) =>
  levels
    .map((l) => `${l.codes.length > 1 ? l.need : 'any'}:${[...l.codes].sort().join(',')}`)
    .join('|');
const parseCell = (raw: string): SheetLevel | { error: string } => {
  const all = raw.includes('+');
  if (all && /[,;/]/.test(raw))
    return { error: 'use either , (any one of them) or + (all of them), not both' };
  const codes = [
    ...new Set(
      raw
        .split(/[+,;/]/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!codes.length) return { error: 'no employee code' };
  if (codes.length > 30) return { error: 'up to 30 people a level' };
  return { need: all && codes.length > 1 ? 'all' : 'any', codes: codes.sort() };
};

const SCOPE_WORDS: Record<Scope, string> = {
  all: 'All staff',
  department: 'Department',
  designation: 'Designation',
  employee_type: 'Employee type',
  employee: 'Employee',
};

/** The employee types staff carry, as people read them. */
const TYPE_WORDS: Record<string, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
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
      await c.query(`SELECT app.staff_leave_seed_all(app.current_school_id())`);
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
          timings: number;
          excluded: number;
          given: number;
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
                  (SELECT count(*)::int FROM staff_timings WHERE status = 'active') AS timings,
                  (SELECT count(*)::int FROM staff_report_exclusions WHERE status = 'active') AS excluded,
                  (SELECT count(*)::int FROM staff_report_access) AS given,
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
          timings: n.timings,
          excluded: n.excluded,
          given: n.given,
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
          : `${SCOPE_WORDS[r.scope]}: ${r.scope_values
              .map((v) => (r.scope === 'employee_type' ? (TYPE_WORDS[v.toLowerCase()] ?? v) : v))
              .join(', ')}`,
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

  /**
   * The people of a rule's level, in words for the list: the named staff or the holders of a designation
   * or a role by name; the HOD and the reporting manager differ per employee, so they are said as such.
   */
  private async levelPeople(c: PoolClient) {
    const names = new Map(
      (
        await c.query<{ id: string; name: string }>(
          `SELECT u.id::text, COALESCE((SELECT x.display_name FROM employees x
                                         WHERE x.user_id = u.id AND x.deleted_at IS NULL LIMIT 1), u.display_name) AS name
             FROM users u
            WHERE EXISTS (SELECT 1 FROM employees x WHERE x.user_id = u.id AND x.deleted_at IS NULL)
               OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`,
        )
      ).rows.map((x) => [x.id, x.name]),
    );
    const held = new Map<string, string[]>();
    return async (l: Level) => {
      const r = l.resolver;
      const need: 'any' | 'all' = l.need === 'all' ? 'all' : 'any';
      if (r.kind === 'staff' && r.by === 'hod')
        return { name: l.name, people: [], need, note: 'HOD of the employee’s department' };
      if (r.kind === 'staff' && r.by === 'manager')
        return { name: l.name, people: [], need, note: 'The employee’s reporting manager' };
      const key = JSON.stringify(r);
      let users = held.get(key);
      if (!users) {
        users = await this.workflow.resolveAssignees(c, r, null, {});
        held.set(key, users);
      }
      const people = users.map((u) => names.get(u) ?? u).sort();
      return { name: l.name, people, need, note: people.length ? null : 'Nobody holds it now' };
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
      await c.query(`SELECT app.staff_leave_seed_all(app.current_school_id())`);
      const rows = (
        await c.query<RuleRow>(
          // eslint-disable-next-line no-restricted-syntax -- RULE is a fixed fragment
          `${RULE} ORDER BY r.kind, (r.status = 'inactive'), r.priority, (r.leave_type_id IS NULL), r.id`,
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
      const who = await this.levelPeople(c);
      const names = new Map(staff.rows.map((x) => [x.code.toLowerCase(), x.name]));
      const shaped = [];
      for (const r of rows) {
        const x = this.shape(r);
        shaped.push({
          ...x,
          // the words for whom, as people read them: employee types by name, employees by name
          scopeWords:
            r.scope === 'all'
              ? SCOPE_WORDS.all
              : `${SCOPE_WORDS[r.scope]}: ${r.scope_values
                  .map((v) =>
                    r.scope === 'employee_type'
                      ? (TYPE_WORDS[v.toLowerCase()] ?? v)
                      : r.scope === 'employee'
                        ? `${names.get(v.toLowerCase()) ?? v} (${v})`
                        : v,
                  )
                  .join(', ')}`,
          bands: await Promise.all(
            x.bands.map(async (b, i) => ({
              ...b,
              who: await Promise.all((r.bands[i]?.levels ?? []).map(who)),
            })),
          ),
        });
      }
      return {
        rules: shaped,
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
        if (dto.place === 'auto' && dto.scope !== 'employee') await this.placeNew(c, dto.kind, id);
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
              need: l.need,
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

  /**
   * A group rule one place up or down in the order rules are checked (its kind; an employee's own rule
   * stays first). The group rules are numbered again 10, 20, 30 … in the order they are read now, then the
   * two swap: the order changes only where it was asked.
   */
  /**
   * A new group rule put in the order: just above the first catch-all rule (all staff, any type), or
   * last when there is none; the group rules are numbered again 10, 20, 30 … keeping the others' order.
   */
  private async placeNew(c: PoolClient, kind: string, id: string) {
    const list = (
      await c.query<{ id: string; catchAll: boolean }>(
        `SELECT id::text, (scope = 'all' AND leave_type_id IS NULL AND status = 'active') AS "catchAll"
           FROM staff_leave_approval_rules
          WHERE kind = $1 AND scope <> 'employee' AND id <> $2
          ORDER BY (status = 'inactive'), priority, (leave_type_id IS NULL), id`,
        [kind, id],
      )
    ).rows;
    const at = list.findIndex((x) => x.catchAll);
    const order = list.map((x) => x.id);
    order.splice(at === -1 ? order.length : at, 0, id);
    for (const [i, x] of order.entries())
      await c.query(
        `UPDATE staff_leave_approval_rules SET priority = $2, updated_at = now() WHERE id = $1`,
        [x, Math.min(9999, 10 * (i + 1))],
      );
  }

  async moveRule(ctx: RequestContext, id: string, dto: MoveRuleDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = (
        await c.query<{ kind: string; scope: string }>(
          `SELECT kind, scope FROM staff_leave_approval_rules WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!me) throw new DomainError('not-found', 'Rule not found', { status: 404 });
      if (me.scope === 'employee')
        throw new DomainError(
          'validation-failed',
          'An employee’s own approvers always come first: they are not moved',
          { status: 400 },
        );
      const list = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM staff_leave_approval_rules
            WHERE kind = $1 AND scope <> 'employee'
            ORDER BY (status = 'inactive'), priority, (leave_type_id IS NULL), id FOR UPDATE`,
          [me.kind],
        )
      ).rows.map((x) => x.id);
      const at = list.indexOf(id);
      const to = dto.direction === 'up' ? at - 1 : at + 1;
      if (to < 0 || to >= list.length) return { moved: false };
      [list[at], list[to]] = [list[to]!, list[at]!];
      for (const [i, x] of list.entries())
        await c.query(
          `UPDATE staff_leave_approval_rules SET priority = $2, updated_at = now() WHERE id = $1`,
          [x, Math.min(9999, 10 * (i + 1))],
        );
      await this.audit.stage(ctx, c, {
        action: 'leave.approval_rule.move',
        entityType: 'staff_leave_approval_rules',
        entityId: id,
        after: { direction: dto.direction },
      });
      return { moved: true };
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
  /**
   * The rules that take each of these employees in, for any leave type (leave) and for corrections, in
   * the order chainFor reads them: by priority, then the oldest. One query for the whole page.
   */
  private async rulesFor(c: PoolClient, employeeIds: string[]) {
    const r = await c.query<{
      emp: string;
      id: string;
      kind: 'leave' | 'regularisation';
      name: string;
      bands: StoredBand[];
    }>(
      `SELECT e.id::text AS emp, r.id::text, r.kind, r.name, r.bands
         FROM employees e
         JOIN staff_leave_approval_rules r
           ON r.status = 'active' AND r.leave_type_id IS NULL
          AND app.staff_in_scope(r.scope, r.scope_values, e.id)
        WHERE e.id = ANY($1::bigint[])
        ORDER BY e.id, r.priority, r.id`,
      [employeeIds],
    );
    const by = new Map<string, typeof r.rows>();
    for (const x of r.rows) by.set(x.emp, [...(by.get(x.emp) ?? []), x]);
    /** the first rule with levels in that band, as chainFor picks it */
    return (emp: string, kind: 'leave' | 'regularisation', band: number) =>
      (by.get(emp) ?? []).find((x) => x.kind === kind && (x.bands[band]?.levels ?? []).length) ??
      null;
  }

  /**
   * Who approves, by employee (the old module's screen): every employee with the approvers the rules
   * give them now — leave of any type in its three day bands, and corrections — with their own rule
   * when they have one. The people of a level are worked out once for all who share them.
   */
  async byEmployee(ctx: RequestContext, dto: ApproversByEmployeeDto) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = [`e.deleted_at IS NULL`, `e.status = 'active'`];
      const params: unknown[] = [];
      if (dto.q) {
        params.push(`%${dto.q}%`);
        where.push(
          `(e.display_name ILIKE $${String(params.length)} OR e.employee_code ILIKE $${String(params.length)})`,
        );
      }
      if (dto.department) {
        params.push(dto.department);
        where.push(`lower(COALESCE(e.department, '')) = lower($${String(params.length)})`);
      }
      const own = `EXISTS (SELECT 1 FROM staff_leave_approval_rules o
                     WHERE o.status = 'active' AND o.scope = 'employee' AND o.leave_type_id IS NULL
                       AND lower(e.employee_code) = ANY(SELECT lower(v) FROM unnest(o.scope_values) v))`;
      if (dto.own) where.push(own);
      const total = (
        await c.query<{ n: number }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `SELECT count(*)::int AS n FROM employees e WHERE ${where.join(' AND ')}`,
          params,
        )
      ).rows[0]!.n;
      const emps = (
        await c.query<{
          id: string;
          code: string | null;
          name: string;
          department: string | null;
          designation: string | null;
          user_id: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.department, e.designation,
                  e.user_id::text
             FROM employees e WHERE ${where.join(' AND ')}
            ORDER BY e.display_name, e.employee_code
            LIMIT ${String(dto.size)} OFFSET ${String((dto.page - 1) * dto.size)}`,
          params,
        )
      ).rows;
      // the employees' own rules (a rule for that one employee and any leave type)
      const owned = await c.query<{ id: string; kind: string; code: string }>(
        `SELECT r.id::text, r.kind, lower(v) AS code
           FROM staff_leave_approval_rules r, unnest(r.scope_values) v
          WHERE r.status = 'active' AND r.scope = 'employee' AND r.leave_type_id IS NULL`,
      );
      const ownOf = (code: string | null, kind: string) =>
        owned.rows.find((o) => o.kind === kind && o.code === (code ?? '').toLowerCase())?.id ??
        null;
      const pick = await this.rulesFor(
        c,
        emps.map((e) => e.id),
      );
      // the people of a level: the same for everybody but an HOD (the department) or a manager
      const held = new Map<string, string[]>();
      const people = async (l: Level, e: (typeof emps)[number]) => {
        const r = l.resolver;
        const key = `${JSON.stringify(r)}|${r.kind === 'staff' && r.by === 'hod' ? (e.department ?? '') : ''}|${r.kind === 'staff' && r.by === 'manager' ? e.id : ''}`;
        let users = held.get(key);
        if (!users) {
          users = await this.workflow.resolveAssignees(c, r, null, {
            department: e.department,
            employeeId: e.id,
          });
          held.set(key, users);
        }
        return users.filter((u) => u !== e.user_id);
      };
      // a band of each kind, by the days that fall in it
      const DAYS = [1, BANDS[0].to + 1, BANDS[1].to + 1];
      const out = [];
      const users = new Set<string>();
      for (const e of emps) {
        const chain = async (kind: 'leave' | 'regularisation', band: number) => {
          const rule = pick(e.id, kind, band);
          if (!rule) return { rule: null, levels: [] };
          const levels = [];
          for (const l of rule.bands[band]!.levels) {
            const who = await people(l, e);
            who.forEach((u) => users.add(u));
            levels.push({ name: l.name, need: l.need === 'all' ? 'all' : 'any', users: who });
          }
          return {
            rule: { id: rule.id, name: rule.name, own: ownOf(e.code, kind) === rule.id },
            levels,
          };
        };
        const leave = [];
        for (const [i, b] of BANDS.entries())
          leave.push({ band: b.label, ...(await chain('leave', bandOf('leave', DAYS[i]!))) });
        out.push({
          id: e.id,
          code: e.code,
          name: e.name,
          department: e.department,
          designation: e.designation,
          signsIn: e.user_id !== null,
          leave,
          regularisation: await chain('regularisation', 0),
          own: { leave: ownOf(e.code, 'leave'), regularisation: ownOf(e.code, 'regularisation') },
        });
      }
      // the names of everybody named, once
      const names = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT u.id::text, COALESCE((SELECT x.display_name || ' (' || x.employee_code || ')' FROM employees x
                                           WHERE x.user_id = u.id AND x.deleted_at IS NULL LIMIT 1), u.display_name) AS name
               FROM users u WHERE u.id = ANY($1::bigint[])`,
            [[...users]],
          )
        ).rows.map((x) => [x.id, x.name]),
      );
      const named = <T extends { levels: Array<{ users: string[] }> }>(ch: T) => ({
        ...ch,
        levels: ch.levels.map(({ users: u, ...l }) => ({
          ...l,
          people: u.map((x) => names.get(x) ?? x).sort(),
        })),
      });
      const departments = (
        await c.query<{ d: string }>(
          `SELECT DISTINCT department AS d FROM employees
            WHERE deleted_at IS NULL AND status = 'active' AND COALESCE(department, '') <> '' ORDER BY 1`,
        )
      ).rows.map((x) => x.d);
      return {
        rows: out.map((r) => ({
          ...r,
          leave: r.leave.map(named),
          regularisation: named(r.regularisation),
        })),
        page: { page: dto.page, size: dto.size, total },
        departments,
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  /**
   * An employee's own rule (priority 1, so it wins over the rules for many): the one they have, or a new
   * one holding the approvers they have now, ready to change.
   */
  async ownRule(ctx: RequestContext, dto: OwnRuleDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = (
        await c.query<{ id: string; code: string | null; name: string }>(
          `SELECT id::text, employee_code AS code, display_name AS name
             FROM employees WHERE id = $1 AND deleted_at IS NULL`,
          [dto.employeeId],
        )
      ).rows[0];
      if (!e) throw new DomainError('not-found', 'Employee not found', { status: 404 });
      if (!e.code)
        throw new DomainError(
          'validation-failed',
          'The employee has no employee code: give one first',
          { status: 400 },
        );
      const have = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM staff_leave_approval_rules
            WHERE status = 'active' AND kind = $1 AND scope = 'employee' AND leave_type_id IS NULL
              AND app.scope_key(scope_values) = lower($2)`,
          [dto.kind, e.code],
        )
      ).rows[0];
      if (have) return { id: have.id, created: false };
      const pick = await this.rulesFor(c, [e.id]);
      const bands = emptyBands(dto.kind).map((b, i) => ({
        ...b,
        levels: pick(e.id, dto.kind, i)?.bands[i]?.levels ?? [],
      }));
      const name =
        `${e.code} – ${e.name}${dto.kind === 'regularisation' ? ' (corrections)' : ''}`.slice(
          0,
          100,
        );
      try {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO staff_leave_approval_rules (school_id, kind, name, scope, scope_values, leave_type_id, bands, priority, created_by)
             VALUES (app.current_school_id(), $1, $2, 'employee', $3, NULL, $4::jsonb, 1, app.current_user_id()) RETURNING id::text`,
            [dto.kind, name, [e.code], JSON.stringify(bands)],
          )
        ).rows[0]!.id;
        await this.audit.stage(ctx, c, {
          action: 'leave.approval_rule.create',
          entityType: 'staff_leave_approval_rules',
          entityId: id,
          after: { name, scope: 'employee', values: [e.code], from: 'by employee' },
        });
        return { id, created: true };
      } catch (err) {
        this.clash(err);
      }
    });
  }

  /**
   * The approvers each of these employees has now, by employee code: the four chains of the sheet
   * (leave up to 7 days, more than 7 up to 30, more than 30; corrections), each level any one or all.
   */
  private async chainCodes(
    c: PoolClient,
    emps: Array<{ id: string; department: string | null; user_id: string | null }>,
  ) {
    const pick = await this.rulesFor(
      c,
      emps.map((e) => e.id),
    );
    const codeOf = new Map(
      (
        await c.query<{ u: string; code: string }>(
          `SELECT user_id::text AS u, employee_code AS code FROM employees
            WHERE user_id IS NOT NULL AND deleted_at IS NULL AND employee_code IS NOT NULL`,
        )
      ).rows.map((x) => [x.u, x.code]),
    );
    const held = new Map<string, string[]>();
    const out = new Map<string, SheetChain[]>();
    for (const e of emps) {
      const chains: SheetChain[] = [];
      for (const [kind, band] of SHEET_CHAINS) {
        const rule = pick(e.id, kind, band);
        const levels: SheetLevel[] = [];
        for (const l of rule?.bands[band]?.levels ?? []) {
          const r = l.resolver;
          const key = `${JSON.stringify(r)}|${r.kind === 'staff' && r.by === 'hod' ? (e.department ?? '') : ''}|${r.kind === 'staff' && r.by === 'manager' ? e.id : ''}`;
          let users = held.get(key);
          if (!users) {
            users = await this.workflow.resolveAssignees(c, r, null, {
              department: e.department,
              employeeId: e.id,
            });
            held.set(key, users);
          }
          const codes = users
            .filter((u) => u !== e.user_id)
            .map((u) => codeOf.get(u))
            .filter((x): x is string => !!x)
            .sort();
          // a level nobody holds for the employee is skipped: it is not on the sheet
          if (codes.length)
            levels.push({ need: codes.length > 1 && l.need === 'all' ? 'all' : 'any', codes });
        }
        chains.push(levels);
      }
      out.set(e.id, chains);
    }
    return out;
  }

  /** Approvers by employee as Excel: every employee, the approvers they have now as codes, to change and upload. */
  async approversFormat(ctx: RequestContext) {
    this.mustView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emps = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          department: string | null;
          user_id: string | null;
        }>(
          `SELECT id::text, employee_code AS code, display_name AS name, department, user_id::text
             FROM employees WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL
            ORDER BY display_name, employee_code LIMIT 5000`,
        )
      ).rows;
      const chains = await this.chainCodes(c, emps);
      const bytes = await templateSheet({
        sheet: 'Approvers',
        hideLists: true,
        columns: [
          { header: 'Employee code', width: 14, required: true, format: 'text' },
          { header: 'Employee', width: 26, note: 'For reading only (the code is read)' },
          { header: 'Department', width: 18, note: 'For reading only' },
          ...SHEET_HEADS.map((h) => ({
            header: h,
            width: 16,
            format: 'text' as const,
            note: 'Approver employee codes. E003: one person. E003, E005: any one of them. E003 + E005: all of them.',
          })),
        ],
        guide: [
          'One row per employee, with the approvers they have now: leave of any type up to 7 days, more than 7 up to 30, more than 30 days, and attendance corrections — up to 3 levels each (L1, L2, L3).',
          'A cell holds approver employee codes: E003 is one person; E003, E005 is any one of them; E003 + E005 is all of them (both must approve).',
          'Change the cells of the employees to change. A row left as it was changes nothing (a second upload of the same file changes nothing).',
          'What you change becomes that employee’s own approvers (their own rule, which comes first). A length left empty: the general rules decide for it.',
          'Fill L1 before L2, and L2 before L3. When the same person is at a later level, that level is approved with them.',
          'Upload it and press Check: every row is checked first; then save.',
        ],
        rows: emps.map((e) => [
          e.code,
          e.name,
          e.department,
          ...chains
            .get(e.id)!
            .flatMap((levels) => [0, 1, 2].map((i) => (levels[i] ? cellOf(levels[i]) : null))),
        ]),
        examples: [
          [
            'E104',
            'Teacher name',
            'Science',
            'E003',
            'E002',
            null,
            'E003',
            'E002',
            'E001',
            'E002',
            'E001',
            null,
            'E003, E011',
            null,
            null,
          ],
          [
            'E105',
            'Office staff',
            'Accounts',
            'E015 + E002',
            null,
            null,
            'E002',
            'E001',
            null,
            'E002',
            'E001',
            null,
            'E002',
            null,
            null,
          ],
        ],
      });
      return {
        filename: 'leave-approvers-by-employee.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /**
   * Approvers by employee from Excel: each row is checked against the approvers the employee has now;
   * the lengths that differ become the employee's own rule (made when there is none), a length left empty
   * going back to the general rules. dryRun only checks.
   */
  async approversImport(ctx: RequestContext, dto: ApproversImportDto) {
    this.mustManage(ctx);
    const rows = await readSheet(dto.file, ['Employee code'], SHEET_HEADS);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const staff = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          department: string | null;
          user_id: string | null;
        }>(
          `SELECT id::text, upper(employee_code) AS code, display_name AS name, department, user_id::text
             FROM employees WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL`,
        )
      ).rows;
      const byCode = new Map(staff.map((x) => [x.code, x]));
      const results: Array<{
        row: number;
        employee: string;
        changes: string[];
        ok: boolean;
        error?: string;
      }> = [];
      const work: Array<{ emp: (typeof staff)[number]; chains: Array<SheetLevel[] | null> }> = [];
      const seen = new Set<string>();
      const read: Array<{ row: number; emp: (typeof staff)[number]; chains: SheetLevel[][] }> = [];
      for (const { row, cells } of rows) {
        const code = (cells['Employee code'] ?? '').trim().toUpperCase();
        if (!code && SHEET_HEADS.every((h) => !(cells[h] ?? '').trim())) continue;
        const e = byCode.get(code);
        const problems: string[] = [];
        if (!e) problems.push(`no active employee has the code ${code || '(empty)'}`);
        if (seen.has(code)) problems.push('the same employee again');
        seen.add(code);
        const chains: SheetLevel[][] = [];
        SHEET_CHAINS.forEach((_, k) => {
          const levels: SheetLevel[] = [];
          let gap = false;
          for (let i = 0; i < 3; i++) {
            const head = SHEET_HEADS[k * 3 + i]!;
            const raw = (cells[head] ?? '').trim();
            if (!raw) {
              gap = true;
              continue;
            }
            if (gap) problems.push(`${head}: fill the level before it first`);
            const parsed = parseCell(raw);
            if ('error' in parsed) {
              problems.push(`${head}: ${parsed.error}`);
              continue;
            }
            for (const x of parsed.codes) {
              const a = byCode.get(x);
              if (!a) problems.push(`${head}: no active employee has the code ${x}`);
              else if (!a.user_id)
                problems.push(`${head}: ${a.name} (${x}) cannot sign in, so cannot approve`);
            }
            levels.push(parsed);
          }
          chains.push(levels);
        });
        if (problems.length) {
          results.push({
            row,
            employee: e ? `${e.name} (${e.code})` : code || '(empty)',
            changes: [],
            ok: false,
            error: problems.join('; '),
          });
          continue;
        }
        read.push({ row, emp: e!, chains });
      }
      // what each employee has now, to change only what differs
      const now = await this.chainCodes(
        c,
        read.map((x) => x.emp),
      );
      for (const x of read) {
        const cur = now.get(x.emp.id)!;
        const changes: string[] = [];
        const diff = x.chains.map((levels, k) => {
          const same = keyOf(levels) === keyOf(cur[k]!);
          if (!same)
            changes.push(
              `${SHEET_LABELS[k]}: ${cur[k]!.map(cellOf).join(' → ') || 'none'} ⇒ ${levels.map(cellOf).join(' → ') || 'the general rules'}`,
            );
          return same ? null : levels;
        });
        results.push({
          row: x.row,
          employee: `${x.emp.name} (${x.emp.code})`,
          changes,
          ok: true,
        });
        if (changes.length) work.push({ emp: x.emp, chains: diff });
      }
      if (dto.dryRun) return { rows: results, saved: 0 };
      let saved = 0;
      for (const w of work) {
        for (const kind of ['leave', 'regularisation'] as const) {
          const idx = SHEET_CHAINS.map((ch, k) => (ch[0] === kind ? k : -1)).filter((k) => k >= 0);
          if (idx.every((k) => w.chains[k] === null)) continue;
          // the employee's own rule of that kind: the one there is, or a new one (its lengths empty)
          let rule = (
            await c.query<{ id: string; bands: StoredBand[] }>(
              `SELECT id::text, bands FROM staff_leave_approval_rules
                WHERE status = 'active' AND kind = $1 AND scope = 'employee' AND leave_type_id IS NULL
                  AND app.scope_key(scope_values) = lower($2)
                FOR UPDATE`,
              [kind, w.emp.code],
            )
          ).rows[0];
          if (!rule) {
            const name =
              `${w.emp.code} – ${w.emp.name}${kind === 'regularisation' ? ' (corrections)' : ''}`.slice(
                0,
                100,
              );
            rule = (
              await c.query<{ id: string; bands: StoredBand[] }>(
                `INSERT INTO staff_leave_approval_rules (school_id, kind, name, scope, scope_values, leave_type_id, bands, priority, created_by)
                 VALUES (app.current_school_id(), $1, $2, 'employee', $3, NULL, $4::jsonb, 1, app.current_user_id())
                 RETURNING id::text, bands`,
                [kind, name, [w.emp.code], JSON.stringify(emptyBands(kind))],
              )
            ).rows[0]!;
          }
          const bands = rule.bands.length ? [...rule.bands] : emptyBands(kind);
          for (const k of idx) {
            const levels = w.chains[k];
            if (!levels) continue;
            const band = SHEET_CHAINS[k]![1];
            bands[band] = {
              ...bands[band]!,
              levels: levels.length
                ? await buildLevels(
                    c,
                    levels.map((l, i) => ({
                      name: `Level ${String(i + 1)}`,
                      by: 'employees' as const,
                      employeeIds: l.codes.map((x) => byCode.get(x)!.id),
                      need: l.need,
                    })),
                    { allowManager: true },
                  )
                : [],
            };
          }
          await c.query(
            `UPDATE staff_leave_approval_rules SET bands = $2::jsonb, updated_at = now() WHERE id = $1`,
            [rule.id, JSON.stringify(bands)],
          );
          await this.audit.stage(ctx, c, {
            action: 'leave.approval_rule.import',
            entityType: 'staff_leave_approval_rules',
            entityId: rule.id,
            after: { employee: w.emp.code, kind },
          });
        }
        saved += 1;
      }
      return { rows: results, saved };
    });
  }

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
      await c.query(`SELECT app.staff_leave_seed_all(app.current_school_id())`);
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
          correction_backdate_days: number | null;
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
                  allow_on_behalf, backdate_days, correction_backdate_days, missing_punch_cc, device_serials, send_email,
                  send_whatsapp, send_app, send_sms, updated_at
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
          correctionBackdateDays: s.correction_backdate_days,
          missingPunchCc: s.missing_punch_cc,
          deviceSerials: s.device_serials,
          sendEmail: s.send_email,
          sendWhatsapp: s.send_whatsapp,
          sendApp: s.send_app,
          sendSms: s.send_sms,
          updatedAt: s.updated_at.toISOString(),
        },
        shifts: shifts.rows,
        // the module's messages and which channels can carry them (Communication → Templates)
        templates: (
          await c.query<{
            code: string;
            channel: string;
            name: string;
            active: boolean;
            ready: boolean;
          }>(
            `SELECT code, channel::text, name, status = 'active' AS active,
                    status = 'active' AND (channel IN ('email', 'push')
                      OR (channel = 'sms' AND COALESCE(btrim(dlt_template_id), '') <> '')
                      OR (channel = 'whatsapp' AND COALESCE(btrim(wa_template_name), '') <> '')) AS ready
               FROM comms_templates WHERE code LIKE 'leave\_%' AND deleted_at IS NULL ORDER BY code, channel`,
          )
        ).rows,
        can: { manage: this.has(ctx, LEAVE.setupManage) },
      };
    });
  }

  async saveSettings(ctx: RequestContext, dto: LeaveSettingsDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_leave_seed_all(app.current_school_id())`);
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
                send_app = $17, send_sms = $18, correction_backdate_days = $19, updated_by = app.current_user_id(),
                updated_at = now()`,
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
          dto.correctionBackdateDays,
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
