/* eslint-disable no-restricted-syntax -- the interpolations in this file are fixed fragments; values are bound */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { MessagesService } from '../comms/messages.service';
import type { SendMessageDto } from '../comms/comms.dto';
import { istToday } from '../purchase/purchase-stock-core';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { chainFor } from './leave-chain';
import {
  addDays,
  available,
  bridgeDays,
  dayKinds,
  dmy,
  fail,
  hold,
  isOff,
  leaveFlow,
  leaveType,
  monthStart,
  monthWords,
  mustBeOpen,
  policyFor,
  release,
  round2,
  sandwiched,
  staffOf,
  type DayKind,
  type Source,
} from './leave-engine';
import {
  LEAVE_OFFICE,
  LEAVE_OWN,
  type ApplyDto,
  type DecideDto,
  type MineQueryDto,
  type OnBehalfDto,
  type OverrideDto,
  type ReasonDto,
  type TrimDto,
  type WithdrawDto,
} from './leave.dto';

const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;

export const REQ = `SELECT r.id::text, r.number, r.employee_id::text, e.display_name AS employee, e.employee_code AS code, e.department,
       e.user_id::text AS employee_user_id, r.leave_type_id::text, t.code AS type_code, t.name AS type_name, t.loss_of_pay,
       r.from_date::text, r.to_date::text, r.days::text, r.half_day, r.session, r.reason, r.document_file_id::text, r.status,
       r.source, (SELECT u.display_name FROM users u WHERE u.id = r.applied_by) AS applied_by, r.applied_by::text AS applied_by_id,
       r.linked_request_id::text, (SELECT x.id::text FROM staff_leave_requests x WHERE x.linked_request_id = r.id LIMIT 1) AS lop_part_id,
       r.held_month::text, r.note, r.workflow_instance_id::text, r.decided_at, r.decision_note,
       (SELECT u.display_name FROM users u WHERE u.id = r.decided_by) AS decided_by, r.cancel_status, r.cancel_reason,
       r.cancel_instance_id::text, r.cancel_raised_at, r.edits, r.created_at,
       (SELECT s.name || ': ' || COALESCE((SELECT string_agg(u.display_name, ', ' ORDER BY u.display_name) FROM users u
                                            WHERE u.id = ANY(s.assignee_user_ids)), 'nobody')
          FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
         WHERE i.id = COALESCE(CASE WHEN r.cancel_status = 'pending' THEN r.cancel_instance_id END, r.workflow_instance_id)
           AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' LIMIT 1) AS waiting_with,
       (SELECT i.current_level FROM workflow_instances i WHERE i.id = r.workflow_instance_id) AS level,
       (SELECT count(*)::int FROM workflow_steps s WHERE s.instance_id = r.workflow_instance_id) AS levels
  FROM staff_leave_requests r JOIN employees e ON e.id = r.employee_id JOIN staff_leave_types t ON t.id = r.leave_type_id`;

export interface ReqRow {
  id: string;
  number: string;
  employee_id: string;
  employee: string;
  code: string;
  department: string | null;
  employee_user_id: string | null;
  leave_type_id: string;
  type_code: string;
  type_name: string;
  loss_of_pay: boolean;
  from_date: string;
  to_date: string;
  days: string;
  half_day: boolean;
  session: 'first' | 'second' | null;
  reason: string;
  document_file_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'cancelled';
  source: Source;
  applied_by: string | null;
  applied_by_id: string | null;
  linked_request_id: string | null;
  lop_part_id: string | null;
  held_month: string | null;
  note: string | null;
  workflow_instance_id: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  decided_by: string | null;
  cancel_status: 'pending' | 'approved' | 'rejected' | null;
  cancel_reason: string | null;
  cancel_instance_id: string | null;
  cancel_raised_at: Date | null;
  edits: number;
  created_at: Date;
  waiting_with: string | null;
  level: number | null;
  levels: number | null;
}

export const SOURCE_WORDS: Record<Source, string> = {
  self: 'Applied',
  on_behalf: 'By the office',
  auto_late: 'Late marks',
  auto_missing: 'Missing punches',
  auto_absent: 'Absent, no application',
  auto_rule: 'Late / early rule',
  import: 'Imported',
};

interface ApplyIn {
  employeeId: string;
  leaveTypeId: string;
  from: string;
  to: string;
  halfDay: boolean;
  session: 'first' | 'second' | null;
  reason: string;
  documentFileId: string | null;
  bridgeOk: boolean;
  splitOk: boolean;
}
interface ApplyOpts {
  source: Source;
  /** approved at once (the office's entry, the system's deductions) */
  approved: boolean;
  /** a range of weekly offs / holidays only is recorded as asked (the office) */
  offDaysOk: boolean;
  /** the fewest days an application, the backdate limit and the document are not asked (office, system) */
  relaxed: boolean;
}
export type ApplyOut =
  | {
      confirm: {
        kind: 'bridge' | 'split';
        message: string;
        from?: string;
        to?: string;
        paid?: number;
        lop?: number;
      };
    }
  | {
      id: string;
      number: string;
      status: string;
      days: number;
      lopNumber?: string;
      note: string | null;
    };

/**
 * Staff leave (docs/design/85, phase B): applying (every check of the earlier module, in its order),
 * approving through the levels of Who approves, withdrawing, cancelling (at once by the office, or asked
 * for and decided through its own chain), trimming the dates, the office's entry for an employee, its
 * decision for the approvers, and the messages.
 */
@Injectable()
export class LeaveService implements OnModuleInit {
  private readonly log = new Logger(LeaveService.name);
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly messages: MessagesService,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('staff_leave', (c, ctx, inst, outcome) =>
      this.onDecided(c, ctx, inst, outcome),
    );
    this.workflow.onComplete('staff_leave_cancel', (c, ctx, inst, outcome) =>
      this.onCancelDecided(c, ctx, inst, outcome),
    );
  }

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  isOffice(ctx: RequestContext) {
    return this.has(ctx, LEAVE_OFFICE);
  }
  private mustOffice(ctx: RequestContext) {
    if (!this.isOffice(ctx))
      throw new DomainError('permission-denied', 'Only the leave office does this', {
        status: 403,
      });
  }

  /** The signed-in user's own employee record. */
  async meIn(c: PoolClient) {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL AND status = 'active'
        ORDER BY id LIMIT 1`,
    );
    return r.rows[0]?.id ?? null;
  }

  async load(c: PoolClient, id: string, lock = false) {
    const r = await c.query<ReqRow>(`${REQ} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`, [
      id,
    ]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Leave not found', { status: 404 });
    return r.rows[0];
  }

  // ---- messages ------------------------------------------------------------------------------------
  /** E-mail and app messages by the school's channels; a message that cannot go never stops the leave. */
  private async notify(
    c: PoolClient,
    ctx: RequestContext,
    code: string,
    userIds: Array<string | null>,
    vars: Record<string, string | number>,
  ) {
    const s = (
      await c.query<{ send_email: boolean; send_app: boolean }>(
        `SELECT send_email, send_app FROM staff_leave_settings`,
      )
    ).rows[0];
    if (!s) return;
    const channels = [...(s.send_email ? ['email'] : []), ...(s.send_app ? ['push'] : [])];
    for (const user of [...new Set(userIds.filter((u): u is string => !!u))])
      for (const channel of channels) {
        await c.query('SAVEPOINT leave_msg');
        try {
          await this.messages.sendWith(c, ctx, {
            templateCode: code,
            channel,
            recipientUserId: user,
            variables: vars,
          } as SendMessageDto);
          await c.query('RELEASE SAVEPOINT leave_msg');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT leave_msg');
          this.log.debug({ code, channel, error: (e as Error).message }, 'leave message not sent');
        }
      }
  }

  private async assigneesOf(c: PoolClient, instanceId: string | null) {
    if (!instanceId) return [];
    const r = await c.query<{ u: string }>(
      `SELECT unnest(s.assignee_user_ids)::text AS u FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
        WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'`,
      [instanceId],
    );
    return r.rows.map((x) => x.u);
  }

  private vars(r: ReqRow, extra: Record<string, string | number> = {}) {
    return {
      number: r.number,
      employee: r.employee,
      type: `${r.type_name} (${r.type_code})`,
      from: dmy(r.from_date),
      to: dmy(r.to_date),
      days: Number(r.days),
      reason: r.reason.slice(0, 300),
      ...extra,
    };
  }

  private async balanceText(c: PoolClient, r: ReqRow) {
    const t = await c.query<{ keeps: boolean }>(
      `SELECT keeps_balance AND NOT loss_of_pay AS keeps FROM staff_leave_types WHERE id = $1`,
      [r.leave_type_id],
    );
    if (!t.rows[0]?.keeps) return '—';
    return String(await available(c, r.employee_id, r.leave_type_id, monthStart(istToday())));
  }

  // ---- apply ---------------------------------------------------------------------------------------
  /**
   * The checks in the earlier module's order: half day, document, gender, days ahead, how far back, the
   * working days (weekly offs and holidays free; the sandwich inside; the bridge to a neighbouring leave,
   * shown first), the payroll lock, the fewest / most days, overlap (the other half of a day allowed),
   * not next to other leave, the balance (short: the paid part + loss of pay, shown first), the most a
   * month, an approver. Then the request, its days, the balance held and the approval started.
   */
  async applyIn(c: PoolClient, ctx: RequestContext, a: ApplyIn, o: ApplyOpts): Promise<ApplyOut> {
    const t = await leaveType(c, a.leaveTypeId);
    const e = await staffOf(c, a.employeeId);
    const today = istToday();
    const system = o.source !== 'self' && o.source !== 'on_behalf';
    if (t.loss_of_pay && o.source === 'self')
      fail(
        'Loss of pay is not applied for: it is charged when a balance is short (the form offers it)',
      );
    if (a.to < a.from) fail('The leave ends before it starts');
    if (a.to > addDays(a.from, 365)) fail('One application is up to a year');
    if (a.halfDay) {
      if (!t.half_day && !t.loss_of_pay) fail(`${t.code} is not taken for half a day`);
      if (a.from !== a.to) fail('A half day is one date');
      if (!a.session) fail('Pick the first or the second half of the day');
    }
    const g = (e.gender ?? '').toLowerCase();
    if ((g === 'male' && !t.for_male) || (g === 'female' && !t.for_female))
      fail(`${t.name} is not for ${g === 'male' ? 'men' : 'women'}`);
    if (t.document_needed && !system && !a.documentFileId)
      fail(`${t.name} needs a document (a certificate or letter): attach it`);
    if (a.documentFileId) {
      const f = await c.query<{ ok: boolean }>(
        `SELECT (status = 'ready' AND size_bytes <= 5242880 AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$'
                 AND (created_by = app.current_user_id() OR $2)) AS ok FROM files WHERE id = $1`,
        [a.documentFileId, o.source === 'on_behalf'],
      );
      if (!f.rows[0]?.ok) fail('Attach your own PDF or image of up to 5 MB');
    }
    if (!t.advance_allowed && a.to > today && !system)
      fail(`${t.code} is for days already passed (or today), not days ahead`);
    const set = (
      await c.query<{ backdate_days: number | null }>(
        `SELECT backdate_days FROM staff_leave_settings`,
      )
    ).rows[0];
    if (
      set?.backdate_days !== null &&
      set?.backdate_days !== undefined &&
      !o.relaxed &&
      a.from < addDays(today, -set.backdate_days)
    )
      fail(
        `Leave can be applied up to ${String(set.backdate_days)} day${set.backdate_days === 1 ? '' : 's'} back: ask the office for earlier days`,
      );
    const pol = await policyFor(c, e.id, t.id);
    // ---- the days counted
    let from = a.from;
    let to = a.to;
    const kinds = await dayKinds(c, e.id, from, to);
    const working = kinds.map((k, i) => (!isOff(k.kind, pol) ? i : -1)).filter((i) => i >= 0);
    const notes: string[] = [];
    let counted: Array<{ day: string; kind: DayKind }>;
    if (!working.length) {
      if (!o.offDaysOk)
        fail(
          a.from === a.to
            ? `${dmy(a.from)} is a weekly off or a holiday`
            : `Every day from ${dmy(a.from)} to ${dmy(a.to)} is a weekly off or a holiday`,
        );
      counted = kinds;
    } else {
      const first = working[0]!;
      const last = working[working.length - 1]!;
      counted = kinds.filter(
        (k, i) => !isOff(k.kind, pol) || (i > first && i < last && sandwiched(k.kind, pol)),
      );
      const sand = counted.filter((k) => isOff(k.kind, pol)).length;
      if (sand)
        notes.push(
          `${String(sand)} weekly off / holiday day${sand > 1 ? 's' : ''} between leave days counted (sandwich)`,
        );
      // the bridge to a leave on either side
      if (!system && !a.halfDay) {
        const bridge = (await bridgeDays(c, e.id, pol, from, to)).filter(
          (b) => !counted.some((k) => k.day === b.day),
        );
        if (bridge.length) {
          const all = [...counted.map((k) => k.day), ...bridge.map((b) => b.day)].sort();
          const bFrom = all[0]!;
          const bTo = all[all.length - 1]!;
          if (!a.bridgeOk)
            return {
              confirm: {
                kind: 'bridge',
                from: bFrom < from ? bFrom : from,
                to: bTo > to ? bTo : to,
                message: `The sandwich rule applies: ${bridge.map((b) => dmy(b.day)).join(', ')} ${bridge.length > 1 ? 'fall' : 'falls'} between this leave and your other leave and ${bridge.length > 1 ? 'are' : 'is'} counted too. Apply from ${dmy(bFrom < from ? bFrom : from)} to ${dmy(bTo > to ? bTo : to)}?`,
              },
            };
          counted = [...counted, ...bridge].sort((x, y) => x.day.localeCompare(y.day));
          from = counted[0]!.day < from ? counted[0]!.day : from;
          to = counted[counted.length - 1]!.day > to ? counted[counted.length - 1]!.day : to;
          notes.push(
            `${String(bridge.length)} day${bridge.length > 1 ? 's' : ''} next to other leave counted (sandwich)`,
          );
        }
      }
    }
    const dayList = counted.map((k) => k.day);
    await mustBeOpen(c, dayList, 'apply');
    const portion = a.halfDay ? 0.5 : 1;
    const days = round2(counted.length * portion);
    // ---- the fewest and most days
    const nums = (xs: Array<string | null | undefined>) =>
      xs.filter((x): x is string => x !== null && x !== undefined).map(Number);
    const mins = nums([t.min_days, pol?.min_days]);
    const maxs = nums([t.max_days, pol?.max_days]);
    if (mins.length && !o.relaxed && !system && days < Math.max(...mins))
      fail(`${t.code} is at least ${String(Math.max(...mins))} days an application`);
    if (maxs.length && days > Math.min(...maxs))
      fail(`${t.code} is at most ${String(Math.min(...maxs))} days an application`);
    // ---- overlap
    const clash = await c.query<{
      day: string;
      number: string;
      status: string;
      session: string | null;
    }>(
      `SELECT d.day::text, r.number, r.status, d.session FROM staff_leave_days d JOIN staff_leave_requests r ON r.id = d.request_id
        WHERE d.employee_id = $1 AND d.status IN ('pending', 'approved') AND d.day = ANY($2::date[]) ORDER BY d.day`,
      [e.id, dayList],
    );
    for (const x of clash.rows) {
      const otherHalf = a.halfDay && x.session && x.session !== a.session;
      if (!otherHalf) fail(`${x.number} (${x.status}) already covers ${dmy(x.day)}`, 409);
    }
    // ---- not next to other leave
    if (t.gap_from_other && !system) {
      for (const side of [-1, 1]) {
        let d = side < 0 ? addDays(from, -1) : addDays(to, 1);
        for (let i = 0; i < 14; i += 1) {
          const k = (await dayKinds(c, e.id, d, d))[0]!;
          if (!isOff(k.kind, pol)) break;
          d = addDays(d, side);
        }
        const near = await c.query<{ number: string; code: string }>(
          `SELECT r.number, t.code FROM staff_leave_days x JOIN staff_leave_requests r ON r.id = x.request_id
             JOIN staff_leave_types t ON t.id = r.leave_type_id
            WHERE x.employee_id = $1 AND x.day = $2::date AND x.status IN ('pending', 'approved') AND r.leave_type_id <> $3 LIMIT 1`,
          [e.id, d, t.id],
        );
        if (near.rows[0])
          fail(
            `${t.code} cannot sit next to other leave: ${near.rows[0].number} (${near.rows[0].code}) is on ${dmy(d)}; a working day must come between`,
          );
      }
    }
    // ---- balance: short → the paid part + loss of pay
    const month = monthStart(today);
    let paid = days;
    let lop = 0;
    let lopType: { id: string; code: string } | null = null;
    if (t.keeps_balance && !t.loss_of_pay) {
      const left = await available(c, e.id, t.id, month);
      if (days > left) {
        lopType =
          (
            await c.query<{ id: string; code: string }>(
              `SELECT id::text, code FROM staff_leave_types WHERE loss_of_pay AND status = 'active'
                ORDER BY deduct_order NULLS LAST, sort_order LIMIT 1`,
            )
          ).rows[0] ?? null;
        if (!lopType)
          fail(`Not enough ${t.code}: ${String(left)} left, ${String(days)} asked`, 409);
        const step = t.half_day ? 0.5 : 1;
        paid = Math.floor(Math.max(0, left) / step) * step;
        lop = round2(days - paid);
        if (!a.splitOk)
          return {
            confirm: {
              kind: 'split',
              paid,
              lop,
              message: `Not enough ${t.code}: ${String(Math.max(0, left))} left. Apply ${paid ? `${String(paid)} ${t.code} + ` : ''}${String(lop)} day${lop === 1 ? '' : 's'} ${lopType!.code} (loss of pay)?`,
            },
          };
      }
    }
    // ---- the most days a month (a type without a balance)
    if (!t.keeps_balance && !t.loss_of_pay && t.max_per_month !== null) {
      const cap = Number(t.max_per_month);
      const byMonth = new Map<string, number>();
      for (const d of dayList)
        byMonth.set(monthStart(d), (byMonth.get(monthStart(d)) ?? 0) + portion);
      for (const [m, n] of byMonth) {
        const r = await c.query<{ n: string }>(
          `SELECT COALESCE(sum(d.portion), 0)::text AS n FROM staff_leave_days d JOIN staff_leave_requests r ON r.id = d.request_id
            WHERE d.employee_id = $1 AND r.leave_type_id = $2 AND d.status IN ('pending', 'approved')
              AND date_trunc('month', d.day) = $3::date`,
          [e.id, t.id, m],
        );
        if (Number(r.rows[0]!.n) + n > cap)
          fail(`${t.code} is at most ${String(cap)} days a month (${monthWords(m)})`);
      }
    }
    // ---- who approves (a leave all loss of pay goes to the approvers of the type asked for)
    const approved = o.approved || (t.auto_approve && paid > 0);
    const chain = approved ? null : await chainFor(c, e.id, 'leave', t.id, days);
    if (!approved && !chain)
      fail(
        `Nobody is set to approve ${t.code} for ${e.name}: ask the leave office to add a rule on Who approves`,
        409,
      );
    // ---- write
    const note = notes.length ? notes.join('; ') : null;
    const status = approved ? 'approved' : 'pending';
    const appliedAs = paid > 0 ? t : { id: lopType!.id, code: lopType!.code };
    const parentDays =
      paid > 0
        ? this.cut(counted, portion, a, paid, 'paid')
        : this.cut(counted, portion, a, days, 'all');
    const parent = await this.insert(c, {
      employeeId: e.id,
      typeId: appliedAs.id,
      days: paid > 0 ? paid : days,
      halfDay: a.halfDay,
      session: a.session,
      reason: a.reason,
      documentFileId: a.documentFileId,
      status,
      source: o.source,
      linkedId: null,
      heldMonth: month,
      note:
        paid > 0 && lop > 0
          ? [note, `${String(lop)} day${lop === 1 ? '' : 's'} loss of pay (${t.code} short)`]
              .filter(Boolean)
              .join('; ')
          : paid === 0 && lop > 0
            ? [note, `all loss of pay (${t.code} short)`].filter(Boolean).join('; ')
            : note,
      days_: parentDays,
      ruleId: chain?.ruleId ?? null,
      today,
    });
    if (paid > 0 && t.keeps_balance && !t.loss_of_pay)
      await hold(c, e.id, t.id, month, paid, `${parent.number} (${status})`, today);
    let child: { id: string; number: string } | null = null;
    if (paid > 0 && lop > 0) {
      child = await this.insert(c, {
        employeeId: e.id,
        typeId: lopType!.id,
        days: lop,
        halfDay: a.halfDay,
        session: a.session,
        reason: `${a.reason} [loss of pay — ${t.code} balance short]`.slice(0, 1000),
        documentFileId: null,
        status,
        source: o.source,
        linkedId: parent.id,
        heldMonth: null,
        note: `the loss-of-pay part of ${parent.number}`,
        days_: this.cut(counted, portion, a, lop, 'rest', paid),
        ruleId: null,
        today,
      });
    }
    if (chain) {
      const code = await leaveFlow(
        c,
        'staff_leave',
        chain.ruleId,
        chain.rule,
        chain.band,
        chain.levels,
      );
      const inst = await this.workflow.start(c, ctx, {
        definitionCode: code,
        entityType: 'staff_leave',
        entityId: parent.id,
        subject: `${parent.number} · ${e.name} · ${appliedAs.code} ${dmy(from)}${from === to ? '' : ` to ${dmy(to)}`}`,
        payload: {
          employeeId: e.id,
          department: e.department ?? '',
          number: parent.number,
          days,
          leaveType: appliedAs.code,
        },
      });
      await c.query(`UPDATE staff_leave_requests SET workflow_instance_id = $2 WHERE id = $1`, [
        parent.id,
        inst.id,
      ]);
      if (inst.status === 'approved') await this.finishApproved(c, ctx, parent.id, null, null);
      else {
        const r = await this.load(c, parent.id);
        await this.notify(
          c,
          ctx,
          'leave_waiting',
          await this.assigneesOf(c, inst.id),
          this.vars(r),
        );
      }
    } else {
      await this.finishApproved(c, ctx, parent.id, null, null);
      if (o.source === 'on_behalf') {
        const r = await this.load(c, parent.id);
        await this.notify(c, ctx, 'leave_approved', [r.employee_user_id], {
          ...this.vars(r),
          by: 'the leave office',
          balance: await this.balanceText(c, r),
        });
      }
    }
    await this.audit.stage(ctx, c, {
      action: 'leave.request.apply',
      entityType: 'staff_leave_requests',
      entityId: parent.id,
      after: {
        number: parent.number,
        type: appliedAs.code,
        from,
        to,
        days,
        paid,
        lop,
        source: o.source,
      },
    });
    const fin = await this.load(c, parent.id);
    return {
      id: parent.id,
      number: parent.number,
      status: fin.status,
      days,
      ...(child ? { lopNumber: child.number } : {}),
      note: fin.note,
    };
  }

  /**
   * The days of the paid part (the first `n` days; a day half paid is paid in its first half), of the
   * loss-of-pay rest (from day `skip`; a half-paid day's second half), or all of them.
   */
  private cut(
    counted: Array<{ day: string; kind: DayKind }>,
    portion: number,
    a: ApplyIn,
    n: number,
    what: 'paid' | 'rest' | 'all',
    skip = 0,
  ) {
    const out: Array<{ day: string; portion: number; session: string | null; kind: DayKind }> = [];
    if (a.halfDay)
      return counted.map((k) => ({ day: k.day, portion: 0.5, session: a.session, kind: k.kind }));
    if (what === 'all') return counted.map((k) => ({ ...k, portion, session: null }));
    let left = n;
    let skipLeft = skip;
    for (const k of counted) {
      let p = 1;
      if (what === 'rest') {
        if (skipLeft >= 1) {
          skipLeft -= 1;
          continue;
        }
        if (skipLeft > 0) {
          // the second half of the day whose first half is paid
          out.push({ day: k.day, portion: 0.5, session: 'second', kind: k.kind });
          left -= 0.5;
          skipLeft = 0;
          continue;
        }
      }
      if (left <= 0) break;
      p = Math.min(1, left);
      out.push({ day: k.day, portion: p, session: p < 1 ? 'first' : null, kind: k.kind });
      left -= p;
    }
    return out;
  }

  private async insert(
    c: PoolClient,
    x: {
      employeeId: string;
      typeId: string;
      days: number;
      halfDay: boolean;
      session: string | null;
      reason: string;
      documentFileId: string | null;
      status: string;
      source: Source;
      linkedId: string | null;
      heldMonth: string | null;
      note: string | null;
      days_: Array<{ day: string; portion: number; session: string | null; kind: DayKind }>;
      ruleId: string | null;
      today: string;
    },
  ) {
    const from = x.days_[0]!.day;
    const to = x.days_[x.days_.length - 1]!.day;
    const r = await c.query<{ id: string; number: string }>(
      `INSERT INTO staff_leave_requests (school_id, number, employee_id, leave_type_id, from_date, to_date, days, half_day, session,
                                         reason, document_file_id, status, source, applied_by, linked_request_id, held_month, note,
                                         approval_rule_id)
       VALUES (app.current_school_id(), app.staff_leave_number($1::date), $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12,
               app.current_user_id(), $13, $14::date, $15, $16)
       RETURNING id::text, number`,
      [
        x.today,
        x.employeeId,
        x.typeId,
        from,
        to,
        x.days,
        x.halfDay,
        x.session,
        x.reason,
        x.documentFileId,
        x.status,
        x.source,
        x.linkedId,
        x.heldMonth,
        x.note,
        x.ruleId,
      ],
    );
    const id = r.rows[0]!.id;
    for (const d of x.days_)
      await c.query(
        `INSERT INTO staff_leave_days (school_id, request_id, employee_id, day, portion, session, kind, status)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, $7)`,
        [id, x.employeeId, d.day, d.portion, d.session, d.kind, x.status],
      );
    return r.rows[0]!;
  }

  // ---- decided --------------------------------------------------------------------------------------
  /** Approved (by the last level, at once, or by the office): the days, the loss-of-pay part, the activity log. */
  /**
   * A leave brought from the old module still waiting at the switch (docs/design/85, phase E): its approval
   * starts at the first level of Who approves (the balance was held when it was brought). 'nobody' when no
   * rule has an approver for it: the leave office decides it from the register.
   */
  async startImported(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
  ): Promise<'started' | 'approved' | 'nobody'> {
    const r = (
      await c.query<{
        employee_id: string;
        leave_type_id: string;
        days: string;
        number: string;
        from_date: string;
        to_date: string;
        code: string;
        name: string;
        department: string | null;
      }>(
        `SELECT r.employee_id::text, r.leave_type_id::text, r.days::text, r.number, r.from_date::text, r.to_date::text,
                t.code, e.display_name AS name, e.department
           FROM staff_leave_requests r JOIN staff_leave_types t ON t.id = r.leave_type_id JOIN employees e ON e.id = r.employee_id
          WHERE r.id = $1 AND r.status = 'pending' AND r.workflow_instance_id IS NULL AND r.linked_request_id IS NULL`,
        [id],
      )
    ).rows[0];
    if (!r) return 'nobody';
    const chain = await chainFor(c, r.employee_id, 'leave', r.leave_type_id, Number(r.days));
    if (!chain) return 'nobody';
    const code = await leaveFlow(
      c,
      'staff_leave',
      chain.ruleId,
      chain.rule,
      chain.band,
      chain.levels,
    );
    const inst = await this.workflow.start(c, ctx, {
      definitionCode: code,
      entityType: 'staff_leave',
      entityId: id,
      subject: `${r.number} · ${r.name} · ${r.code} ${dmy(r.from_date)}${r.from_date === r.to_date ? '' : ` to ${dmy(r.to_date)}`}`,
      payload: {
        employeeId: r.employee_id,
        department: r.department ?? '',
        number: r.number,
        days: Number(r.days),
        leaveType: r.code,
      },
    });
    await c.query(
      `UPDATE staff_leave_requests SET workflow_instance_id = $2, approval_rule_id = $3 WHERE id = $1`,
      [id, inst.id, chain.ruleId],
    );
    if (inst.status === 'approved') {
      await this.finishApproved(c, ctx, id, null, null);
      return 'approved';
    }
    return 'started';
  }

  private async finishApproved(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    by: string | null,
    note: string | null,
  ) {
    await c.query(
      `UPDATE staff_leave_requests SET status = 'approved', decided_at = now(), decided_by = COALESCE($2::bigint, app.current_user_id()),
              decision_note = $3, updated_at = now()
        WHERE id = $1 OR linked_request_id = $1`,
      [id, by, note],
    );
    await c.query(
      `UPDATE staff_leave_days SET status = 'approved'
        WHERE request_id IN (SELECT id FROM staff_leave_requests WHERE id = $1 OR linked_request_id = $1)`,
      [id],
    );
    // the attendance register shows the leave (the loss-of-pay part last, as payroll reads it)
    await c.query(
      `SELECT app.staff_attendance_apply_leave(x.id) FROM staff_leave_requests x
        WHERE x.id = $1 OR x.linked_request_id = $1 ORDER BY (x.linked_request_id IS NOT NULL), x.id`,
      [id],
    );
    // the daily activity log knows the day of leave (full or half)
    await c.query(
      `INSERT INTO activity_logs (school_id, employee_id, on_date, state, submitted_at, leave_kind, leave_type, leave_reason, leave_by)
       SELECT app.current_school_id(), d.employee_id, d.day, 'submitted', now(),
              CASE WHEN sum(d.portion) >= 1 THEN 'full' ELSE 'half' END, string_agg(DISTINCT t.code, '+'), left(min(r.reason), 300),
              app.current_user_id()
         FROM staff_leave_days d JOIN staff_leave_requests r ON r.id = d.request_id JOIN staff_leave_types t ON t.id = r.leave_type_id
        WHERE (r.id = $1 OR r.linked_request_id = $1) AND d.status = 'approved'
        GROUP BY d.employee_id, d.day
       ON CONFLICT (employee_id, on_date) DO UPDATE SET leave_kind = EXCLUDED.leave_kind, leave_type = EXCLUDED.leave_type,
              leave_reason = EXCLUDED.leave_reason, leave_by = EXCLUDED.leave_by,
              state = CASE WHEN activity_logs.state IN ('draft', 'returned') THEN 'submitted' ELSE activity_logs.state END`,
      [id],
    );
    void ctx;
  }

  /** The days of a leave leave the activity log (cancelled, trimmed). */
  private async clearActivity(c: PoolClient, employeeId: string, days: string[]) {
    if (!days.length) return;
    await c.query(
      `UPDATE activity_logs l SET leave_kind = NULL, leave_type = NULL, leave_reason = NULL, leave_by = NULL,
              state = CASE WHEN NOT EXISTS (SELECT 1 FROM activity_entries x WHERE x.log_id = l.id) THEN 'draft' ELSE l.state END
        WHERE l.employee_id = $1 AND l.on_date = ANY($2::date[]) AND l.leave_kind IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM staff_leave_days d WHERE d.employee_id = $1 AND d.day = l.on_date AND d.status = 'approved')`,
      [employeeId, days],
    );
  }

  /** Closed without being taken (rejected, withdrawn, cancelled): the days, the balance back, the log. */
  private async close(
    c: PoolClient,
    r: ReqRow,
    status: 'rejected' | 'withdrawn' | 'cancelled',
    note: string | null,
    today: string,
  ) {
    const wasApproved = r.status === 'approved';
    await c.query(
      `UPDATE staff_leave_requests SET status = $2, decided_at = now(), decided_by = app.current_user_id(), decision_note = $3,
              updated_at = now()
        WHERE id = $1 OR linked_request_id = $1`,
      [r.id, status, note],
    );
    const days = (
      await c.query<{ day: string }>(
        `UPDATE staff_leave_days SET status = $2
          WHERE request_id IN (SELECT id FROM staff_leave_requests WHERE id = $1 OR linked_request_id = $1)
            AND status IN ('pending', 'approved') RETURNING day::text`,
        [r.id, status],
      )
    ).rows.map((x) => x.day);
    if (r.held_month)
      await release(
        c,
        r.employee_id,
        r.leave_type_id,
        r.held_month,
        Number(r.days),
        `${r.number} ${status}`,
        today,
      );
    if (wasApproved) {
      await this.clearActivity(c, r.employee_id, days);
      await c.query(`SELECT app.staff_attendance_remove_leave($1, $2::date[])`, [
        r.employee_id,
        days,
      ]);
    }
  }

  /** The workflow's last word on a leave. */
  private async onDecided(
    c: PoolClient,
    ctx: RequestContext,
    inst: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    // a cancelled approval (withdrawn, cancelled, decided by the office) is closed by the leave itself
    if (inst.status === 'cancelled') return;
    const r = await this.load(c, inst.entityId, true);
    if (r.status !== 'pending') return;
    const last = [...inst.steps].reverse().find((s) => s.actedAt);
    const by = last?.actedBy ?? 'the approver';
    if (outcome === 'approved') {
      await this.finishApproved(c, ctx, r.id, null, last?.note ?? null);
      const fin = await this.load(c, r.id);
      await this.notify(c, ctx, 'leave_approved', [r.employee_user_id], {
        ...this.vars(fin),
        by,
        balance: await this.balanceText(c, fin),
      });
    } else {
      await this.close(c, r, 'rejected', last?.note ?? null, istToday());
      await this.notify(c, ctx, 'leave_rejected', [r.employee_user_id], {
        ...this.vars(r),
        by,
        note: last?.note ?? '',
      });
    }
  }

  private async onCancelDecided(
    c: PoolClient,
    ctx: RequestContext,
    inst: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    if (inst.status === 'cancelled') return;
    const r = await this.load(c, inst.entityId, true);
    if (r.cancel_status !== 'pending') return;
    const last = [...inst.steps].reverse().find((s) => s.actedAt);
    if (outcome === 'approved') {
      if (r.status === 'approved') await this.close(c, r, 'cancelled', r.cancel_reason, istToday());
      await c.query(`UPDATE staff_leave_requests SET cancel_status = 'approved' WHERE id = $1`, [
        r.id,
      ]);
      await this.notify(c, ctx, 'leave_cancelled', [r.employee_user_id], {
        ...this.vars(r),
        by: last?.actedBy ?? 'the approver',
        note: r.cancel_reason ?? '',
      });
    } else {
      await c.query(`UPDATE staff_leave_requests SET cancel_status = 'rejected' WHERE id = $1`, [
        r.id,
      ]);
      await this.notify(c, ctx, 'leave_rejected', [r.employee_user_id], {
        ...this.vars(r),
        by: last?.actedBy ?? 'the approver',
        note: `the cancellation is not approved${last?.note ? `: ${last.note}` : ''}`,
      });
    }
  }

  // ---- the endpoints --------------------------------------------------------------------------------
  async apply(ctx: RequestContext, dto: ApplyDto) {
    if (!this.has(ctx, LEAVE_OWN))
      throw new DomainError('permission-denied', 'Applying for leave is not open to you', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.meIn(c);
      if (!me) fail('Your sign-in is not linked to an employee: ask the office', 403);
      return this.applyIn(
        c,
        ctx,
        {
          ...dto,
          employeeId: me!,
          session: dto.session ?? null,
          documentFileId: dto.documentFileId ?? null,
        },
        { source: 'self', approved: false, offDaysOk: false, relaxed: false },
      );
    });
  }

  /**
   * The office's entry for an employee: approved at once, the fewest days and the document not asked, a
   * range of off days recorded as asked; leave already on those days is cancelled first — all in one go,
   * so nothing is cancelled when the entry is refused or stops to ask.
   */
  async onBehalf(ctx: RequestContext, dto: OnBehalfDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{ allow_on_behalf: boolean }>(
          `SELECT allow_on_behalf FROM staff_leave_settings`,
        )
      ).rows[0];
      if (s && !s.allow_on_behalf)
        fail('Leave for an employee is switched off in Leave & attendance settings', 409);
      await c.query('SAVEPOINT on_behalf');
      const old = await c.query<ReqRow>(
        `${REQ} WHERE r.employee_id = $1 AND r.status IN ('pending', 'approved') AND r.linked_request_id IS NULL
            AND r.from_date <= $3::date AND r.to_date >= $2::date FOR UPDATE OF r`,
        [dto.employeeId, dto.from, dto.to],
      );
      const today = istToday();
      for (const r of old.rows) {
        if (r.status === 'approved')
          await mustBeOpen(c, [r.from_date, r.to_date], 'change its leave');
        if (r.workflow_instance_id && r.status === 'pending')
          await this.workflow.cancelIn(
            c,
            ctx,
            r.workflow_instance_id,
            'Replaced by the office’s entry',
          );
        await this.close(c, r, 'cancelled', 'Replaced by the office’s entry', today);
      }
      const out = await this.applyIn(
        c,
        ctx,
        { ...dto, session: dto.session ?? null, documentFileId: dto.documentFileId ?? null },
        { source: 'on_behalf', approved: true, offDaysOk: true, relaxed: true },
      );
      if ('confirm' in out) {
        await c.query('ROLLBACK TO SAVEPOINT on_behalf');
        return out;
      }
      return { ...out, replaced: old.rows.map((r) => r.number) };
    });
  }

  /** An approver's decision at their level (a rejection says why); the next level is told. */
  async decide(ctx: RequestContext, id: string, dto: DecideDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.status !== 'pending' || !r.workflow_instance_id)
        fail(`${r.number} is ${r.status}, not waiting for a decision`, 409);
      const s = await c.query<{ id: string }>(MY_STEP, [r.workflow_instance_id]);
      if (!s.rows[0])
        fail('This leave is not waiting for you, or somebody has already decided it', 403);
      if (dto.outcome === 'approved') await mustBeOpen(c, [r.from_date, r.to_date], 'approve it');
      return { step: s.rows[0]!.id, instance: r.workflow_instance_id! };
    });
    await this.workflow.act(ctx, step.step, dto.outcome, { note: dto.note || undefined });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.status === 'pending')
        await this.notify(
          c,
          ctx,
          'leave_waiting',
          await this.assigneesOf(c, step.instance),
          this.vars(r),
        );
      return { id, status: r.status, waitingWith: r.waiting_with };
    });
  }

  /** The employee takes back a leave still waiting (the office: cancels it). */
  async withdraw(ctx: RequestContext, id: string, dto: WithdrawDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id, true);
      const me = await this.meIn(c);
      const own = !!me && me === r.employee_id;
      if (!own && !this.isOffice(ctx))
        throw new DomainError('not-found', 'Leave not found', { status: 404 });
      if (r.linked_request_id) fail('Withdraw the paid part: the loss-of-pay part goes with it');
      if (r.status !== 'pending')
        fail(
          r.status === 'approved'
            ? 'An approved leave is cancelled through a cancellation request'
            : `${r.number} is ${r.status}`,
          409,
        );
      const status = own ? 'withdrawn' : 'cancelled';
      const why = dto.reason || (own ? 'Withdrawn by the employee' : 'Cancelled by the office');
      const waiting = await this.assigneesOf(c, r.workflow_instance_id);
      if (r.workflow_instance_id) await this.workflow.cancelIn(c, ctx, r.workflow_instance_id, why);
      await this.close(c, r, status, why, istToday());
      await this.notify(
        c,
        ctx,
        'leave_cancelled',
        own ? waiting : [r.employee_user_id, ...waiting],
        { ...this.vars(r), by: own ? r.employee : 'the leave office', note: why },
      );
      await this.audit.stage(ctx, c, {
        action: `leave.request.${status}`,
        entityType: 'staff_leave_requests',
        entityId: id,
        after: { number: r.number, reason: why },
      });
      return { id, status };
    });
  }

  /** The office cancels a leave at once (pending or approved); an approved one's days are open again. */
  async cancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id, true);
      if (r.linked_request_id) fail('Cancel the paid part: the loss-of-pay part goes with it');
      if (r.status !== 'pending' && r.status !== 'approved')
        fail(`${r.number} is ${r.status}`, 409);
      if (r.status === 'approved') await mustBeOpen(c, [r.from_date, r.to_date], 'cancel it');
      if (r.status === 'pending' && r.workflow_instance_id)
        await this.workflow.cancelIn(c, ctx, r.workflow_instance_id, dto.reason);
      if (r.cancel_status === 'pending' && r.cancel_instance_id)
        await this.workflow.cancelIn(c, ctx, r.cancel_instance_id, dto.reason);
      await this.close(c, r, 'cancelled', dto.reason, istToday());
      if (r.cancel_status === 'pending')
        await c.query(`UPDATE staff_leave_requests SET cancel_status = 'approved' WHERE id = $1`, [
          id,
        ]);
      await this.notify(c, ctx, 'leave_cancelled', [r.employee_user_id], {
        ...this.vars(r),
        by: 'the leave office',
        note: dto.reason,
      });
      await this.audit.stage(ctx, c, {
        action: 'leave.request.cancel',
        entityType: 'staff_leave_requests',
        entityId: id,
        after: { number: r.number, reason: dto.reason },
      });
      return { id, status: 'cancelled' };
    });
  }

  /** The employee asks to cancel an approved leave: decided by the approvers of Who approves today. */
  async requestCancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id, true);
      const me = await this.meIn(c);
      if (!(me && me === r.employee_id) && !this.isOffice(ctx))
        throw new DomainError('not-found', 'Leave not found', { status: 404 });
      if (r.linked_request_id)
        fail('Ask to cancel the paid part: the loss-of-pay part goes with it');
      if (r.status !== 'approved')
        fail(
          r.status === 'pending'
            ? 'A leave still waiting is withdrawn, not cancelled'
            : `${r.number} is ${r.status}`,
          409,
        );
      if (r.cancel_status === 'pending')
        fail('A cancellation of this leave is already waiting', 409);
      await mustBeOpen(c, [r.from_date, r.to_date], 'cancel it');
      const chain = await chainFor(c, r.employee_id, 'leave', r.leave_type_id, Number(r.days));
      if (!chain)
        fail('Nobody is set to approve a cancellation for you: ask the leave office', 409);
      const code = await leaveFlow(
        c,
        'staff_leave_cancel',
        chain!.ruleId,
        chain!.rule,
        chain!.band,
        chain!.levels,
      );
      const inst = await this.workflow.start(c, ctx, {
        definitionCode: code,
        entityType: 'staff_leave_cancel',
        entityId: r.id,
        subject: `Cancel ${r.number} · ${r.employee} · ${r.type_code} ${dmy(r.from_date)}${r.from_date === r.to_date ? '' : ` to ${dmy(r.to_date)}`}`,
        payload: { employeeId: r.employee_id, department: r.department ?? '', number: r.number },
      });
      await c.query(
        `UPDATE staff_leave_requests SET cancel_status = 'pending', cancel_reason = $2, cancel_raised_by = app.current_user_id(),
                cancel_raised_at = now(), cancel_instance_id = $3, updated_at = now()
          WHERE id = $1`,
        [id, dto.reason, inst.id],
      );
      if (inst.status === 'approved') {
        await this.onCancelDecided(c, ctx, inst, 'approved');
      } else
        await this.notify(c, ctx, 'leave_cancel_waiting', await this.assigneesOf(c, inst.id), {
          ...this.vars(r),
          reason: dto.reason,
        });
      await this.audit.stage(ctx, c, {
        action: 'leave.request.cancel_asked',
        entityType: 'staff_leave_requests',
        entityId: id,
        after: { number: r.number, reason: dto.reason },
      });
      return { id, cancelStatus: inst.status === 'approved' ? 'approved' : 'pending' };
    });
  }

  async decideCancel(ctx: RequestContext, id: string, dto: DecideDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.cancel_status !== 'pending' || !r.cancel_instance_id)
        fail('No cancellation of this leave is waiting', 409);
      const s = await c.query<{ id: string }>(MY_STEP, [r.cancel_instance_id]);
      if (!s.rows[0]) fail('This cancellation is not waiting for you', 403);
      if (dto.outcome === 'approved') await mustBeOpen(c, [r.from_date, r.to_date], 'cancel it');
      return { step: s.rows[0]!.id, instance: r.cancel_instance_id! };
    });
    await this.workflow.act(ctx, step.step, dto.outcome, { note: dto.note || undefined });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.cancel_status === 'pending')
        await this.notify(
          c,
          ctx,
          'leave_cancel_waiting',
          await this.assigneesOf(c, step.instance),
          {
            ...this.vars(r),
            reason: r.cancel_reason ?? '',
          },
        );
      return { id, status: r.status, cancelStatus: r.cancel_status };
    });
  }

  /** The office decides for every level still to act (with a reason): the same effects as their decision. */
  async override(ctx: RequestContext, id: string, dto: OverrideDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id, true);
      if (r.status !== 'pending' || !r.workflow_instance_id)
        fail(`${r.number} is ${r.status}: only a leave waiting is decided for the approvers`, 409);
      if (dto.outcome === 'approved') await mustBeOpen(c, [r.from_date, r.to_date], 'approve it');
      const note = `Decided by the leave office: ${dto.reason}`;
      await this.workflow.cancelIn(c, ctx, r.workflow_instance_id!, note);
      if (dto.outcome === 'approved') {
        await this.finishApproved(c, ctx, r.id, null, note);
        const fin = await this.load(c, r.id);
        await this.notify(c, ctx, 'leave_approved', [r.employee_user_id], {
          ...this.vars(fin),
          by: 'the leave office',
          balance: await this.balanceText(c, fin),
        });
      } else {
        await this.close(c, r, 'rejected', note, istToday());
        await this.notify(c, ctx, 'leave_rejected', [r.employee_user_id], {
          ...this.vars(r),
          by: 'the leave office',
          note: dto.reason,
        });
      }
      await this.audit.stage(ctx, c, {
        action: 'leave.request.override',
        entityType: 'staff_leave_requests',
        entityId: id,
        after: { number: r.number, outcome: dto.outcome, reason: dto.reason },
      });
      return { id, status: dto.outcome };
    });
  }

  /**
   * The office shortens an approved leave from one end (a new application adds days): the days cut are
   * open again, the balance given back, the employee told.
   */
  async trim(ctx: RequestContext, id: string, dto: TrimDto) {
    this.mustOffice(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id, true);
      if (r.status !== 'approved') fail('Only an approved leave is shortened', 409);
      if (r.linked_request_id || r.lop_part_id)
        fail(
          'A leave split into a paid part and loss of pay is not shortened: cancel it and enter it again',
          409,
        );
      if (dto.from < r.from_date || dto.to > r.to_date || dto.to < dto.from)
        fail(
          `The new dates lie within ${dmy(r.from_date)} to ${dmy(r.to_date)} (a new application adds days)`,
        );
      if (dto.from !== r.from_date && dto.to !== r.to_date) fail('Move one end at a time');
      if (dto.from === r.from_date && dto.to === r.to_date) fail('The dates are the same');
      const live = (
        await c.query<{ day: string; portion: string }>(
          `SELECT day::text, portion::text FROM staff_leave_days WHERE request_id = $1 AND status = 'approved' ORDER BY day`,
          [id],
        )
      ).rows;
      const removed = live.filter((d) => d.day < dto.from || d.day > dto.to);
      const kept = live.filter((d) => d.day >= dto.from && d.day <= dto.to);
      if (!kept.length) fail('At least one day stays: cancel the leave instead');
      if (!removed.length) fail('No counted day is cut by those dates');
      await mustBeOpen(
        c,
        removed.map((d) => d.day),
        'shorten it',
      );
      const cut = round2(removed.reduce((s, d) => s + Number(d.portion), 0));
      const newDays = round2(Number(r.days) - cut);
      await c.query(
        `UPDATE staff_leave_days SET status = 'cancelled' WHERE request_id = $1 AND day = ANY($2::date[])`,
        [id, removed.map((d) => d.day)],
      );
      await c.query(
        `UPDATE staff_leave_requests SET from_date = $2::date, to_date = $3::date, days = $4, edits = edits + 1, updated_at = now()
          WHERE id = $1`,
        [id, kept[0]!.day, kept[kept.length - 1]!.day, newDays],
      );
      if (r.held_month)
        await release(
          c,
          r.employee_id,
          r.leave_type_id,
          r.held_month,
          cut,
          `${r.number} shortened`,
          istToday(),
        );
      await c.query(
        `INSERT INTO staff_leave_edits (school_id, request_id, old_from, old_to, old_days, new_from, new_to, new_days, removed, reason, edited_by)
         VALUES (app.current_school_id(), $1, $2::date, $3::date, $4, $5::date, $6::date, $7, $8::date[], $9, app.current_user_id())`,
        [
          id,
          r.from_date,
          r.to_date,
          r.days,
          kept[0]!.day,
          kept[kept.length - 1]!.day,
          newDays,
          removed.map((d) => d.day),
          dto.reason,
        ],
      );
      await this.clearActivity(
        c,
        r.employee_id,
        removed.map((d) => d.day),
      );
      await c.query(`SELECT app.staff_attendance_remove_leave($1, $2::date[])`, [
        r.employee_id,
        removed.map((d) => d.day),
      ]);
      const fin = await this.load(c, id);
      await this.notify(c, ctx, 'leave_changed', [r.employee_user_id], {
        ...this.vars(fin),
        by: 'the leave office',
        note: dto.reason,
      });
      await this.audit.stage(ctx, c, {
        action: 'leave.request.trim',
        entityType: 'staff_leave_requests',
        entityId: id,
        after: { number: r.number, from: kept[0]!.day, to: kept[kept.length - 1]!.day, cut },
      });
      return { id, from: fin.from_date, to: fin.to_date, days: Number(fin.days) };
    });
  }

  // ---- reading -------------------------------------------------------------------------------------
  shape(r: ReqRow) {
    return {
      id: r.id,
      number: r.number,
      employee: { id: r.employee_id, name: r.employee, code: r.code, department: r.department },
      leaveType: {
        id: r.leave_type_id,
        code: r.type_code,
        name: r.type_name,
        lossOfPay: r.loss_of_pay,
      },
      from: r.from_date,
      to: r.to_date,
      days: Number(r.days),
      halfDay: r.half_day,
      session: r.session,
      reason: r.reason,
      documentFileId: r.document_file_id,
      status: r.status,
      source: r.source,
      sourceWords: SOURCE_WORDS[r.source],
      appliedBy: r.applied_by,
      linkedRequestId: r.linked_request_id,
      lopPartId: r.lop_part_id,
      note: r.note,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decidedBy: r.decided_by,
      decisionNote: r.decision_note,
      cancelStatus: r.cancel_status,
      cancelReason: r.cancel_reason,
      edits: r.edits,
      appliedAt: r.created_at.toISOString(),
      waitingWith: r.waiting_with,
      level: r.level,
      levels: r.levels,
    };
  }

  /** One leave: its facts, days, the approval levels, the cancellation, the changes, what the viewer may do. */
  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      const me = await this.meIn(c);
      const own = !!me && me === r.employee_id;
      const office = this.isOffice(ctx);
      const mayDecide = r.workflow_instance_id
        ? !!(await c.query(MY_STEP, [r.workflow_instance_id])).rowCount
        : false;
      const mayDecideCancel =
        r.cancel_status === 'pending' && r.cancel_instance_id
          ? !!(await c.query(MY_STEP, [r.cancel_instance_id])).rowCount
          : false;
      const approver = r.workflow_instance_id
        ? !!(
            await c.query(
              `SELECT 1 FROM workflow_steps s WHERE s.instance_id = ANY($1::bigint[])
                 AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id()) LIMIT 1`,
              [[r.workflow_instance_id, r.cancel_instance_id].filter(Boolean)],
            )
          ).rowCount
        : false;
      if (!own && !office && !approver && !mayDecideCancel)
        throw new DomainError('not-found', 'Leave not found', { status: 404 });
      const days = await c.query<{
        day: string;
        portion: string;
        session: string | null;
        kind: string;
        status: string;
      }>(
        `SELECT day::text, portion::text, session, kind, status FROM staff_leave_days
          WHERE request_id IN (SELECT id FROM staff_leave_requests WHERE id = $1 OR linked_request_id = $1) ORDER BY day, session NULLS FIRST`,
        [id],
      );
      const steps = async (instanceId: string | null) =>
        instanceId
          ? ((await this.workflow.instanceWith(c, instanceId))?.steps.map((s) => ({
              level: s.level,
              name: s.name,
              people: s.assignees.map((a) => a.name),
              status: s.status,
              actedBy: s.actedBy,
              actedAt: s.actedAt,
              note: s.note,
              overdue: s.overdue,
            })) ?? [])
          : [];
      const edits = await c.query<{
        old_from: string;
        old_to: string;
        new_from: string;
        new_to: string;
        old_days: string;
        new_days: string;
        reason: string;
        by: string | null;
        at: Date;
      }>(
        `SELECT old_from::text, old_to::text, new_from::text, new_to::text, old_days::text, new_days::text, reason,
                (SELECT display_name FROM users u WHERE u.id = x.edited_by) AS by, edited_at AS at
           FROM staff_leave_edits x WHERE request_id = $1 ORDER BY edited_at`,
        [id],
      );
      const lop = r.lop_part_id ? this.shape(await this.load(c, r.lop_part_id)) : null;
      const live = r.status === 'pending' || r.status === 'approved';
      return {
        ...this.shape(r),
        lopPart: lop,
        dayRows: days.rows.map((d) => ({
          day: d.day,
          portion: Number(d.portion),
          session: d.session,
          kind: d.kind,
          status: d.status,
        })),
        approval: await steps(r.workflow_instance_id),
        cancellation: await steps(r.cancel_instance_id),
        changes: edits.rows.map((x) => ({
          from: `${x.old_from} to ${x.old_to} (${x.old_days})`,
          to: `${x.new_from} to ${x.new_to} (${x.new_days})`,
          reason: x.reason,
          by: x.by,
          at: x.at.toISOString(),
        })),
        can: {
          withdraw: own && r.status === 'pending' && !r.linked_request_id,
          requestCancel:
            own && r.status === 'approved' && r.cancel_status !== 'pending' && !r.linked_request_id,
          decide: mayDecide && r.status === 'pending',
          decideCancel: mayDecideCancel,
          cancel: office && live && !r.linked_request_id,
          override: office && r.status === 'pending' && !!r.workflow_instance_id,
          trim:
            office &&
            r.status === 'approved' &&
            !r.linked_request_id &&
            !r.lop_part_id &&
            days.rows.filter((d) => d.status === 'approved').length > 1,
        },
      };
    });
  }

  /** The signed-in employee's page: balances, the types they may apply for, their leave, what waits for them. */
  async mine(ctx: RequestContext, q: MineQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.meIn(c);
      const waiting = await this.waitingCount(c);
      if (!me)
        return {
          employee: null,
          balances: [],
          types: [],
          rows: [],
          total: 0,
          page: q.page,
          size: q.size,
          waiting,
          can: { apply: false, office: this.isOffice(ctx) },
        };
      const e = await staffOf(c, me);
      const month = monthStart(istToday());
      const types = await c.query<{
        id: string;
        code: string;
        name: string;
        keeps: boolean;
        lop: boolean;
        half_day: boolean;
        document_needed: boolean;
        max_days: string | null;
        auto: boolean;
      }>(
        `SELECT t.id::text, t.code, t.name, t.keeps_balance AND NOT t.loss_of_pay AS keeps, t.loss_of_pay AS lop,
                t.half_day OR t.loss_of_pay AS half_day, t.document_needed, t.max_days::text, t.auto_approve AS auto
           FROM staff_leave_types t
          WHERE t.status = 'active'
            AND ((SELECT gender::text FROM employees WHERE id = $1) IS DISTINCT FROM 'male' OR t.for_male)
            AND ((SELECT gender::text FROM employees WHERE id = $1) IS DISTINCT FROM 'female' OR t.for_female)
          ORDER BY t.sort_order, t.code`,
        [me],
      );
      const balances = [];
      for (const t of types.rows.filter((x) => x.keeps)) {
        const b = await c.query<{
          opening: string;
          credited: string;
          held: string;
          correction: string;
        }>(
          `SELECT opening::text, credited::text, held::text, correction::text FROM app.staff_leave_balance_peek($1, $2, $3::date)`,
          [me, t.id, month],
        );
        const x = b.rows[0]!;
        const pol = await policyFor(c, me, t.id);
        balances.push({
          typeId: t.id,
          code: t.code,
          name: t.name,
          available: round2(
            Number(x.opening) + Number(x.credited) + Number(x.correction) - Number(x.held),
          ),
          held: Number(x.held),
          policy: pol?.name ?? null,
        });
      }
      const total = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM staff_leave_requests WHERE employee_id = $1`,
          [me],
        )
      ).rows[0]!.n;
      const rows = await c.query<ReqRow>(
        `${REQ} WHERE r.employee_id = $1 ORDER BY r.from_date DESC, r.id DESC LIMIT $2 OFFSET $3`,
        [me, q.size, (q.page - 1) * q.size],
      );
      return {
        employee: { id: e.id, name: e.name, code: e.code, department: e.department },
        balances,
        types: types.rows
          .filter((t) => !t.lop)
          .map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            keepsBalance: t.keeps,
            halfDay: t.half_day,
            documentNeeded: t.document_needed,
            maxDays: t.max_days === null ? null : Number(t.max_days),
            approvedAtOnce: t.auto,
          })),
        rows: rows.rows.map((r) => this.shape(r)),
        total,
        page: q.page,
        size: q.size,
        waiting,
        can: { apply: this.has(ctx, LEAVE_OWN), office: this.isOffice(ctx) },
      };
    });
  }

  private async waitingCount(c: PoolClient) {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
        WHERE i.entity_type IN ('staff_leave', 'staff_leave_cancel') AND i.status = 'pending' AND s.level = i.current_level
          AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`,
    );
    return r.rows[0]!.n;
  }

  /** What waits for my decision (leave and cancellations), oldest first; and what I decided lately. */
  async approvals(ctx: RequestContext, view: 'waiting' | 'decided') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows =
        view === 'waiting'
          ? await c.query<ReqRow & { what: string; since: Date }>(
              `${REQ.replace('FROM staff_leave_requests r', ', i.entity_type AS what, i.requested_at AS since FROM staff_leave_requests r')}
                JOIN workflow_instances i ON i.entity_id = r.id AND i.entity_type IN ('staff_leave', 'staff_leave_cancel') AND i.status = 'pending'
                JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
               WHERE ${WorkflowService.MAY_ACT}
               ORDER BY i.requested_at LIMIT 500`,
            )
          : await c.query<ReqRow & { what: string; since: Date }>(
              `${REQ.replace('FROM staff_leave_requests r', ', i.entity_type AS what, s.acted_at AS since FROM staff_leave_requests r')}
                JOIN workflow_instances i ON i.entity_id = r.id AND i.entity_type IN ('staff_leave', 'staff_leave_cancel')
                JOIN workflow_steps s ON s.instance_id = i.id AND s.acted_by = app.current_user_id()
               ORDER BY s.acted_at DESC LIMIT 100`,
            );
      return {
        rows: rows.rows.map((r) => ({
          ...this.shape(r),
          what: r.what === 'staff_leave_cancel' ? 'cancellation' : 'leave',
          since: r.since.toISOString(),
        })),
      };
    });
  }
}
