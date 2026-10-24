import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { FilesService } from '../../files/files.service';
import { WorkflowService, type InstanceRow } from '../../workflow/workflow.service';
import { PEOPLE } from '../people.permissions';
import {
  EMPLOYEE_TYPE_LABEL,
  EXIT_ENTITY,
  ExitSetupService,
  exitFlowCode,
} from './exit-setup.service';
import { ExitClearanceService } from './exit-clearance.service';
import type {
  EmployeeType,
  ExitCreateDto,
  ExitDecisionDto,
  ExitEditDto,
  ExitListDto,
  MyExitDto,
} from './exits.dto';

type Status = 'pending' | 'sent_back' | 'approved' | 'rejected' | 'withdrawn';
interface Emp {
  id: string;
  code: string;
  name: string;
  type: EmployeeType;
  department: string | null;
  designation: string | null;
  user_id: string | null;
  status: string;
}
interface ExitDb {
  id: string;
  employee_id: string;
  exit_type: string;
  type_name: string | null;
  notice_applies: boolean | null;
  reason: string;
  letter_file_id: string | null;
  requested_on: string;
  proposed_last_day: string;
  notice_days: number;
  expected_last_day: string;
  accepted_last_day: string | null;
  notice_waived: boolean;
  status: Status;
  by_self: boolean;
  raised_by: string | null;
  raised_by_name: string | null;
  workflow_instance_id: string | null;
  sent_back_note: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  emp_code: string;
  emp_name: string;
  emp_type: EmployeeType;
  emp_department: string | null;
  emp_designation: string | null;
  emp_user: string | null;
  waiting_at: string | null;
}
export interface ExitRow {
  id: string;
  employee: {
    id: string;
    code: string;
    name: string;
    type: EmployeeType;
    typeName: string;
    department: string | null;
    designation: string | null;
  };
  exitType: { code: string; name: string };
  reason: string;
  letterFileId: string | null;
  requestedOn: string;
  proposedLastDay: string;
  noticeDays: number;
  expectedLastDay: string;
  /** Days the proposed last day falls short of the notice period (0 when waived or not short). */
  shortfallDays: number;
  acceptedLastDay: string | null;
  noticeWaived: boolean;
  status: Status;
  bySelf: boolean;
  raisedBy: string | null;
  sentBackNote: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  waitingAt: string | null;
}

const SELECT = `SELECT x.id::text, x.employee_id::text, x.exit_type, t.name AS type_name, t.notice_applies, x.reason, x.letter_file_id::text,
       x.requested_on::text, x.proposed_last_day::text, x.notice_days, x.expected_last_day::text, x.accepted_last_day::text,
       x.notice_waived, x.status, x.by_self, x.raised_by::text, ru.display_name AS raised_by_name, x.workflow_instance_id::text,
       x.sent_back_note, x.decision_note, du.display_name AS decided_by_name, x.decided_at,
       e.employee_code AS emp_code, e.display_name AS emp_name, e.employee_type::text AS emp_type, e.department AS emp_department,
       e.designation AS emp_designation, e.user_id::text AS emp_user,
       (SELECT s.name FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
         WHERE s.instance_id = x.workflow_instance_id AND s.level = i.current_level AND i.status = 'pending' LIMIT 1) AS waiting_at
  FROM employee_exits x JOIN employees e ON e.id = x.employee_id
  LEFT JOIN employee_exit_types t ON t.code = x.exit_type
  LEFT JOIN users ru ON ru.id = x.raised_by LEFT JOIN users du ON du.id = x.decided_by`;

const days = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

function toRow(x: ExitDb): ExitRow {
  return {
    id: x.id,
    employee: {
      id: x.employee_id,
      code: x.emp_code,
      name: x.emp_name,
      type: x.emp_type,
      typeName: EMPLOYEE_TYPE_LABEL[x.emp_type] ?? x.emp_type,
      department: x.emp_department,
      designation: x.emp_designation,
    },
    exitType: { code: x.exit_type, name: x.type_name ?? x.exit_type },
    reason: x.reason,
    letterFileId: x.letter_file_id,
    requestedOn: x.requested_on,
    proposedLastDay: x.proposed_last_day,
    noticeDays: x.notice_days,
    expectedLastDay: x.expected_last_day,
    shortfallDays: x.notice_waived
      ? 0
      : Math.max(0, days(x.expected_last_day, x.accepted_last_day ?? x.proposed_last_day)),
    acceptedLastDay: x.accepted_last_day,
    noticeWaived: x.notice_waived,
    status: x.status,
    bySelf: x.by_self,
    raisedBy: x.raised_by_name,
    sentBackNote: x.sent_back_note,
    decisionNote: x.decision_note,
    decidedBy: x.decided_by_name,
    decidedAt: x.decided_at?.toISOString() ?? null,
    waitingAt: x.waiting_at,
  };
}

/**
 * Employee exit, part 5 (docs/design/38): the request (the employee's resignation from the staff app, or
 * any exit the office records on their behalf) and its approval through the levels of the employee's
 * type. A level approves (and may set the accepted last working day and waive the notice), sends back
 * with a remark (the request is changed and sent again) or rejects. A resignation may be withdrawn until
 * it is accepted.
 */
@Injectable()
export class ExitsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly setup: ExitSetupService,
    private readonly files: FilesService,
    private readonly clearance: ExitClearanceService,
  ) {}

  private async employee(c: PoolClient, id: string): Promise<Emp> {
    const r = await c.query<Emp>(
      `SELECT id::text, employee_code AS code, display_name AS name, employee_type::text AS type, department, designation,
              user_id::text, status::text FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Employee not found', { status: 404 });
    return r.rows[0];
  }

  /** The signed-in person's employee record (the staff app). */
  private async me(c: PoolClient, ctx: RequestContext): Promise<Emp> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      [ctx.user.id],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', 'Your sign-in is not linked to an employee record', {
        status: 404,
      });
    return this.employee(c, r.rows[0].id);
  }

  private async find(c: PoolClient, id: string): Promise<ExitDb> {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Exit not found', { status: 404 });
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment
    const r = await c.query<ExitDb>(`${SELECT} WHERE x.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Exit not found', { status: 404 });
    return r.rows[0];
  }

  private event(
    c: PoolClient,
    ctx: RequestContext,
    exitId: string,
    what: string,
    note?: string | null,
  ) {
    return c.query(
      `INSERT INTO employee_exit_events (school_id, exit_id, what, note, by_user, by_name)
       VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4)`,
      [exitId, what, note ?? null, ctx.user.displayName],
    );
  }

  /** The step waiting with the signed-in person (or one they stand in for). */
  private async myStep(c: PoolClient, instanceId: string | null): Promise<string | null> {
    if (!instanceId) return null;
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
      `SELECT s.id::text FROM workflow_instances i
         JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
        WHERE i.id = $1 AND i.status = 'pending' AND ${WorkflowService.MAY_ACT}`,
      [instanceId],
    );
    return r.rows[0]?.id ?? null;
  }

  private async takesPart(c: PoolClient, instanceId: string | null): Promise<boolean> {
    if (!instanceId) return false;
    const r = await c.query(
      // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
      `SELECT 1 FROM workflow_steps s WHERE s.instance_id = $1 AND (${WorkflowService.MAY_ACT} OR s.acted_by = app.current_user_id()) LIMIT 1`,
      [instanceId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** The type, the notice and the dates of a request, checked. */
  private async plan(
    c: PoolClient,
    emp: Emp,
    input: { exitType: string; requestedOn?: string; proposedLastDay?: string },
    self: boolean,
  ) {
    const types = await this.setup.typesWith(c);
    const t = types.find((x) => x.code === input.exitType && x.active);
    if (!t)
      throw new DomainError('validation-failed', 'Choose an exit type from the list', {
        status: 400,
      });
    if (self && !t.staffMayApply)
      throw new DomainError(
        'people.exit_not_for_staff',
        `${t.name} is recorded by the office, not asked for in the staff app`,
        { status: 403 },
      );
    const notice = t.noticeApplies ? ((await this.setup.noticeWith(c))[emp.type] ?? 0) : 0;
    const requestedOn = input.requestedOn ?? today();
    const expected = addDays(requestedOn, notice);
    const proposed = input.proposedLastDay ?? expected;
    if (proposed < requestedOn)
      throw new DomainError(
        'validation-failed',
        'The last working day cannot be before the day of the request',
        { status: 400 },
      );
    return { type: t, notice, requestedOn, expected, proposed };
  }

  private async checkLetter(c: PoolClient, fileId: string | null | undefined) {
    if (!fileId) return;
    const f = await c.query(
      `SELECT 1 FROM files WHERE id = $1 AND deleted_at IS NULL AND status <> 'rejected'`,
      [fileId],
    );
    if (!f.rowCount)
      throw new DomainError('validation-failed', 'The letter is not uploaded; attach it again', {
        status: 400,
      });
  }

  /** Sends the request through the levels of the employee's type. */
  private async startFlow(c: PoolClient, ctx: RequestContext, x: ExitDb) {
    await this.setup.ensureFlow(c, x.emp_type);
    const instance = await this.workflow.start(c, ctx, {
      definitionCode: exitFlowCode(x.emp_type),
      entityType: EXIT_ENTITY,
      entityId: x.id,
      subject:
        `${x.type_name ?? x.exit_type}: ${x.emp_name} (${x.emp_code}), last day ${x.proposed_last_day.split('-').reverse().join('-')}`.slice(
          0,
          240,
        ),
      payload: {
        employeeId: x.employee_id,
        employee: x.emp_name,
        code: x.emp_code,
        department: x.emp_department,
        exitType: x.type_name ?? x.exit_type,
        proposedLastDay: x.proposed_last_day,
        reason: x.reason,
      },
    });
    await c.query(`UPDATE employee_exits SET workflow_instance_id = $2 WHERE id = $1`, [
      x.id,
      instance.id,
    ]);
    // every level may have been skipped or approved on its own (nobody holds it, or the raiser holds it)
    if (instance.status === 'approved') await this.onDecision(c, ctx, instance, 'approved');
  }

  private async createIn(
    c: PoolClient,
    ctx: RequestContext,
    emp: Emp,
    dto: MyExitDto,
    self: boolean,
  ): Promise<ExitRow> {
    if (emp.status !== 'active')
      throw new DomainError('people.exit_inactive', 'The employee is not active', { status: 409 });
    const p = await this.plan(c, emp, dto, self);
    await this.checkLetter(c, dto.letterFileId);
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO employee_exits (school_id, employee_id, exit_type, reason, letter_file_id, requested_on, proposed_last_day,
                                     notice_days, expected_last_day, by_self, raised_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::date, $6::date, $7, $8::date, $9, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          emp.id,
          p.type.code,
          dto.reason,
          dto.letterFileId ?? null,
          p.requestedOn,
          p.proposed,
          p.notice,
          p.expected,
          self,
        ],
      );
      id = r.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError(
          'people.exit_open',
          'An exit of this employee is already in progress',
          { status: 409 },
        );
      throw error;
    }
    await this.event(
      c,
      ctx,
      id,
      'submitted',
      self ? 'Asked in the staff app' : `Recorded by the office for ${emp.name}`,
    );
    await this.startFlow(c, ctx, await this.find(c, id));
    await this.audit.stage(ctx, c, {
      action: 'people.exit.create',
      entityType: 'employee_exits',
      entityId: id,
      after: { employeeId: emp.id, exitType: p.type.code, proposedLastDay: p.proposed, self },
    });
    return toRow(await this.find(c, id));
  }

  /** The office records an exit on an employee's behalf (any type). */
  async create(ctx: RequestContext, dto: ExitCreateDto) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.createIn(c, ctx, await this.employee(c, dto.employeeId), dto, false),
    );
  }

  async list(ctx: RequestContext, q: ExitListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<ExitDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; values are bound
        `${SELECT} WHERE ($1::text IS NULL OR x.status = $1) AND ($2::text IS NULL OR e.search_text LIKE '%' || app.search_text($2) || '%' OR lower(e.employee_code) = lower($2))
          ORDER BY x.requested_on DESC, x.id DESC LIMIT 500`,
        [q.status ?? null, q.q ?? null],
      );
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM employee_exits GROUP BY status`,
      );
      return {
        data: r.rows.map(toRow),
        counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])),
      };
    });
  }

  /** One exit with its timeline, its approval steps and what the signed-in person may do. */
  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.find(c, id);
      const own = x.emp_user !== null && x.emp_user === ctx.user.id;
      const office = ctx.permissions?.has(PEOPLE.exitView) === true;
      if (!office && !own && !(await this.takesPart(c, x.workflow_instance_id)))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      const events = await c.query<{
        what: string;
        note: string | null;
        by_name: string | null;
        at: Date;
      }>(
        `SELECT what, note, by_name, at FROM employee_exit_events WHERE exit_id = $1 ORDER BY at, id`,
        [id],
      );
      const instance = x.workflow_instance_id
        ? await this.workflow.instanceWith(c, x.workflow_instance_id)
        : null;
      const step = await this.myStep(c, x.workflow_instance_id);
      const manage = ctx.permissions?.has(PEOPLE.exitManage) === true;
      if (x.status === 'approved') await this.clearance.makeBoard(c, x.id);
      const clearances = await this.clearance.rowsWith(c, ctx, {
        id: x.id,
        employeeId: x.employee_id,
        department: x.emp_department,
        open: x.status === 'approved',
      });
      return {
        ...toRow(x),
        clearances,
        events: events.rows.map((e) => ({
          what: e.what,
          note: e.note,
          by: e.by_name,
          at: e.at.toISOString(),
        })),
        steps: (instance?.steps ?? []).map((s) => ({
          level: s.level,
          name: s.name,
          status: s.status,
          assignees: s.assignees.map((a) => a.name),
          actedBy: s.actedBy,
          actedAt: s.actedAt,
          note: s.note,
        })),
        may: {
          decide: x.status === 'pending' && step !== null,
          withdraw: ['pending', 'sent_back'].includes(x.status) && (own || manage),
          edit: x.status === 'sent_back' && (own || manage),
        },
      };
    });
  }

  /** The letter of an exit, for whoever may see the exit (the office, the employee, an approver). */
  async letter(ctx: RequestContext, id: string) {
    const fileId = await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.find(c, id);
      const own = x.emp_user !== null && x.emp_user === ctx.user.id;
      const office = ctx.permissions?.has(PEOPLE.exitView) === true;
      if (!office && !own && !(await this.takesPart(c, x.workflow_instance_id)))
        throw new DomainError('not-found', 'Exit not found', { status: 404 });
      if (!x.letter_file_id)
        throw new DomainError('not-found', 'No letter is attached', { status: 404 });
      return x.letter_file_id;
    });
    return this.files.downloadUrl(ctx, fileId);
  }

  /** An approver's decision on the exit waiting with them. */
  async decide(
    ctx: RequestContext,
    id: string,
    action: 'approve' | 'send_back' | 'reject',
    dto: ExitDecisionDto,
  ) {
    if (action !== 'approve' && !dto.note?.trim())
      throw new DomainError(
        'validation-failed',
        action === 'send_back' ? 'Say what to change' : 'Give the reason',
        { status: 400, extra: { errors: { note: 'is required' } } },
      );
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.find(c, id);
      if (x.status !== 'pending')
        throw new DomainError('people.exit_not_pending', 'The exit is not waiting for approval', {
          status: 409,
        });
      const s = await this.myStep(c, x.workflow_instance_id);
      if (!s)
        throw new DomainError('people.exit_not_with_you', 'This exit is not waiting with you', {
          status: 403,
        });
      if (action === 'approve') {
        if (dto.acceptedLastDay && dto.acceptedLastDay < x.requested_on)
          throw new DomainError(
            'validation-failed',
            'The last working day cannot be before the day of the request',
            { status: 400 },
          );
        if (dto.acceptedLastDay !== undefined || dto.waiveNotice !== undefined) {
          await c.query(
            `UPDATE employee_exits SET accepted_last_day = COALESCE($2::date, accepted_last_day),
                    notice_waived = COALESCE($3, notice_waived), updated_at = now(), updated_by = app.current_user_id()
              WHERE id = $1`,
            [id, dto.acceptedLastDay ?? null, dto.waiveNotice ?? null],
          );
          await this.event(
            c,
            ctx,
            id,
            'terms',
            [
              dto.acceptedLastDay
                ? `Last working day ${dto.acceptedLastDay.split('-').reverse().join('-')}`
                : null,
              dto.waiveNotice === true
                ? 'notice waived'
                : dto.waiveNotice === false
                  ? 'notice held'
                  : null,
            ]
              .filter(Boolean)
              .join(', '),
          );
        }
      } else
        await c.query(`UPDATE employee_exits SET closing_as = $2 WHERE id = $1`, [
          id,
          action === 'send_back' ? 'sent_back' : 'rejected',
        ]);
      return s;
    });
    await this.workflow.act(ctx, step, action === 'approve' ? 'approved' : 'rejected', {
      note: dto.note,
    });
    return this.get(ctx, id);
  }

  /** The last level decided, or the approval ended early (sent back, rejected, withdrawn). */
  async onDecision(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const r = await c.query<{ status: string; closing_as: string | null; proposed: string }>(
      `SELECT status, closing_as, proposed_last_day::text AS proposed FROM employee_exits
        WHERE id = $1 AND workflow_instance_id = $2 FOR UPDATE`,
      [instance.entityId, instance.id],
    );
    const x = r.rows[0];
    if (!x || x.status !== 'pending') return;
    const note =
      [...instance.steps].reverse().find((s) => s.status !== 'pending' && s.note)?.note ?? null;
    if (outcome === 'approved') {
      await c.query(
        `UPDATE employee_exits SET status = 'approved', accepted_last_day = COALESCE(accepted_last_day, proposed_last_day),
                decided_by = app.current_user_id(), decided_at = now(), decision_note = $2, updated_at = now() WHERE id = $1`,
        [instance.entityId, note],
      );
      await this.event(c, ctx, instance.entityId, 'approved', note);
      // the no-dues clearance starts (part 6)
      await this.clearance.makeBoard(c, instance.entityId);
      return;
    }
    const cancelled = await c.query<{ status: string }>(
      `SELECT status::text FROM workflow_instances WHERE id = $1`,
      [instance.id],
    );
    const status: Status =
      cancelled.rows[0]?.status === 'cancelled'
        ? 'withdrawn'
        : x.closing_as === 'sent_back'
          ? 'sent_back'
          : 'rejected';
    await c.query(
      `UPDATE employee_exits SET status = $2, closing_as = NULL, sent_back_note = CASE WHEN $2 = 'sent_back' THEN $3 ELSE sent_back_note END,
              decision_note = CASE WHEN $2 = 'rejected' THEN $3 ELSE decision_note END,
              decided_by = CASE WHEN $2 = 'rejected' THEN app.current_user_id() ELSE decided_by END,
              decided_at = CASE WHEN $2 = 'rejected' THEN now() ELSE decided_at END, updated_at = now()
        WHERE id = $1`,
      [instance.entityId, status, note],
    );
    await this.event(c, ctx, instance.entityId, status, note);
  }

  /** The employee (or the office) withdraws a request not yet accepted. */
  private async withdrawIn(c: PoolClient, ctx: RequestContext, x: ExitDb, reason?: string) {
    if (!['pending', 'sent_back'].includes(x.status))
      throw new DomainError(
        'people.exit_accepted',
        x.status === 'approved'
          ? 'The exit is accepted: it can no longer be withdrawn'
          : 'The exit is already closed',
        { status: 409 },
      );
    if (x.status === 'pending' && x.workflow_instance_id)
      await this.workflow.cancelIn(c, ctx, x.workflow_instance_id, reason || 'Withdrawn');
    else {
      await c.query(
        `UPDATE employee_exits SET status = 'withdrawn', updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [x.id],
      );
      await this.event(c, ctx, x.id, 'withdrawn', reason ?? null);
    }
    await this.audit.stage(ctx, c, {
      action: 'people.exit.withdraw',
      entityType: 'employee_exits',
      entityId: x.id,
      after: { reason: reason ?? null },
    });
  }

  async withdraw(ctx: RequestContext, id: string, reason?: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.find(c, id);
      const own = x.emp_user !== null && x.emp_user === ctx.user.id;
      if (!own && ctx.permissions?.has(PEOPLE.exitManage) !== true)
        throw new DomainError(
          'permission-denied',
          'Only the employee or the office may withdraw it',
          {
            status: 403,
          },
        );
      await this.withdrawIn(c, ctx, x, reason);
    });
    return this.get(ctx, id);
  }

  /** A request sent back, changed and sent through the levels again. */
  async resubmit(ctx: RequestContext, id: string, dto: ExitEditDto) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.find(c, id);
      const own = x.emp_user !== null && x.emp_user === ctx.user.id;
      if (!own && ctx.permissions?.has(PEOPLE.exitManage) !== true)
        throw new DomainError(
          'permission-denied',
          'Only the employee or the office may change it',
          {
            status: 403,
          },
        );
      if (x.status !== 'sent_back')
        throw new DomainError('people.exit_not_sent_back', 'Only a request sent back is changed', {
          status: 409,
        });
      await this.checkLetter(c, dto.letterFileId);
      if (dto.proposedLastDay && dto.proposedLastDay < x.requested_on)
        throw new DomainError(
          'validation-failed',
          'The last working day cannot be before the day of the request',
          { status: 400 },
        );
      await c.query(
        `UPDATE employee_exits SET reason = COALESCE($2, reason), letter_file_id = CASE WHEN $3::boolean THEN $4::bigint ELSE letter_file_id END,
                proposed_last_day = COALESCE($5::date, proposed_last_day), accepted_last_day = NULL, notice_waived = false,
                status = 'pending', updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.reason ?? null,
          dto.letterFileId !== undefined,
          dto.letterFileId ?? null,
          dto.proposedLastDay ?? null,
        ],
      );
      await this.event(c, ctx, id, 'resubmitted', 'Changed and sent again');
      await this.startFlow(c, ctx, await this.find(c, id));
    });
    return this.get(ctx, id);
  }

  // ---- the staff app ------------------------------------------------------------------------------
  /** My exits, the types I may ask for and my notice period. */
  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const emp = await this.me(c, ctx);
      const types = (await this.setup.typesWith(c)).filter((t) => t.active && t.staffMayApply);
      const notice = (await this.setup.noticeWith(c))[emp.type] ?? 0;
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment
      const r = await c.query<ExitDb>(`${SELECT} WHERE x.employee_id = $1 ORDER BY x.id DESC`, [
        emp.id,
      ]);
      const rows = r.rows.map(toRow);
      const open = r.rows.find((x) => x.status === 'approved');
      const clearances = open
        ? (
            await this.clearance.rowsWith(c, ctx, {
              id: open.id,
              employeeId: open.employee_id,
              department: open.emp_department,
              open: false,
            })
          ).map(({ department, name, status, dues, actedAt }) => ({
            department,
            name,
            status,
            dues,
            actedAt,
          }))
        : [];
      return {
        clearances,
        employee: {
          id: emp.id,
          name: emp.name,
          code: emp.code,
          typeName: EMPLOYEE_TYPE_LABEL[emp.type],
        },
        types: types.map((t) => ({ code: t.code, name: t.name, noticeApplies: t.noticeApplies })),
        noticeDays: notice,
        data: rows,
      };
    });
  }

  async applyMine(ctx: RequestContext, dto: MyExitDto) {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.createIn(c, ctx, await this.me(c, ctx), dto, true),
    );
  }

  /** Exits waiting at the signed-in person's level (the staff app and the admin header). */
  async toApprove(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<ExitDb & { due_at: Date | null }>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and MAY_ACT are fixed fragments
        `${SELECT}
           JOIN workflow_instances wi ON wi.id = x.workflow_instance_id AND wi.status = 'pending'
           JOIN workflow_steps s ON s.instance_id = wi.id AND s.level = wi.current_level AND s.status = 'pending'
          WHERE x.status = 'pending' AND ${WorkflowService.MAY_ACT}
          ORDER BY x.requested_on, x.id`,
      );
      return { data: r.rows.map(toRow) };
    });
  }
}
