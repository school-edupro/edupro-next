import { Injectable } from '@nestjs/common';
import { amountInWords, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { AdmissionCoreService } from './admission-core.service';
import { admissionReceiptPdf } from './admission-pdf';
import { messageTag } from './message-tag';

/** The approval levels of an admission fee refund, edited on Fees → Approval (docs/design/54). */
export const AR_FLOW = { code: 'admission_refund', entityType: 'admission_refund' } as const;
const DEFAULT_LEVELS = [
  {
    level: 1,
    name: 'Accounts check',
    resolver: { kind: 'role', roleCode: 'accountant' },
    slaHours: 48,
  },
  {
    level: 2,
    name: 'Principal approval',
    resolver: { kind: 'role', roleCode: 'school_admin' },
    slaHours: 48,
  },
];
/** Who may pay an approved refund out: the cashier, or a refund approver. */
const PAYERS = ['fees.receipt.post', 'fees.refund.approve'];
/** Who may see the refunds: the admission office and Accounts. */
const VIEWERS = [
  'admissions.application.view',
  'fees.refund.request',
  'fees.receipt.post',
  'fees.refund.approve',
];
const REFUND_APPROVE = 'fees.refund.approve';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const has = (ctx: RequestContext, codes: string[]) =>
  codes.some((p) => ctx.permissions?.has(p) ?? false);

/** The levels exist (made with the standard two the first time); whether they are in use. */
export async function ensureRefundFlow(c: PoolClient): Promise<boolean> {
  await c.query(
    `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
     SELECT app.current_school_id(), $1, 'Admission fee refund', $2, $3::jsonb, '{}'::text[], app.current_user_id(), app.current_user_id()
      WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
    [AR_FLOW.code, AR_FLOW.entityType, JSON.stringify(DEFAULT_LEVELS)],
  );
  const r = await c.query<{ status: string }>(
    `SELECT status::text FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL`,
    [AR_FLOW.code],
  );
  return r.rows[0]?.status === 'active';
}

/**
 * A new admission refund rides the levels when they are in use (a cancel on the registration page, or
 * on the student page): the instance is kept on the refund. With the levels switched off, nothing.
 */
export async function startRefundFlow(
  workflow: WorkflowService,
  c: PoolClient,
  ctx: RequestContext,
  refundId: string,
): Promise<string | null> {
  if (!(await ensureRefundFlow(c))) return null;
  const r = await c.query<{ amount: string; candidate: string | null; number: string | null }>(
    `SELECT f.amount::text, a.candidate_name AS candidate, COALESCE(a.admission_no, a.application_no) AS number
       FROM admission_refunds f JOIN applications a ON a.id = f.application_id WHERE f.id = $1`,
    [refundId],
  );
  const x = r.rows[0];
  if (!x) return null;
  const inst = await workflow.start(c, ctx, {
    definitionCode: AR_FLOW.code,
    entityType: AR_FLOW.entityType,
    entityId: refundId,
    subject: `Admission fee refund: ${x.candidate ?? 'Candidate'} (${x.number ?? '-'}), ${money(Number(x.amount))}`,
    payload: { amount: Number(x.amount) },
  });
  await c.query(`UPDATE admission_refunds SET workflow_instance_id = $2 WHERE id = $1`, [
    refundId,
    inst.id,
  ]);
  return inst.id;
}

interface Row {
  id: string;
  application_id: string;
  number: string | null;
  admission_no: string | null;
  candidate: string | null;
  class_name: string;
  session: string;
  receipt_no: string;
  paid_amount: string;
  deduction_pct: string;
  deduction: string;
  amount: string;
  reason: string;
  status: string;
  requested_at: Date;
  requested_by: string | null;
  decided_at: Date | null;
  decided_by: string | null;
  decision_note: string | null;
  mode: string | null;
  reference: string | null;
  paid_on: string | null;
  paid_by: string | null;
  instance_id: string | null;
  voucher_file_id: string | null;
  contact_mobile: string | null;
  contact_email: string | null;
}

/**
 * Admission fee refunds (docs/design/54): approved through the levels of Fees → Approval (the Workflow
 * inbox, Fees → Refunds → Admission refunds, or Admissions → Admission fee refunds), then paid by
 * Accounts with a voucher. With the levels switched off, a refund approver decides in one step.
 */
@Injectable()
export class AdmissionRefundsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly core: AdmissionCoreService,
    private readonly workflow: WorkflowService,
  ) {}

  private mayView(ctx: RequestContext) {
    if (!has(ctx, VIEWERS))
      throw new DomainError(
        'permission-denied',
        'Admission refunds are for the office and Accounts',
        {
          status: 403,
        },
      );
  }

  private async rows(c: PoolClient, where: string, params: unknown[]) {
    return (
      await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- `where` is one of the fixed conditions below; values are bound
        `SELECT f.id::text, f.application_id::text, a.application_no AS number, a.admission_no, a.candidate_name AS candidate,
                cl.name AS class_name, y.name AS session, m.receipt_no, f.paid_amount::text, f.deduction_pct::text, f.deduction::text,
                f.amount::text, f.reason, f.status, f.requested_at, ur.display_name AS requested_by, f.decided_at,
                ud.display_name AS decided_by, f.decision_note, f.mode, f.reference, f.paid_on::text, up.display_name AS paid_by,
                f.workflow_instance_id::text AS instance_id, f.voucher_file_id::text, a.contact_mobile, a.contact_email
           FROM admission_refunds f JOIN applications a ON a.id = f.application_id JOIN classes cl ON cl.id = a.class_id
           JOIN admission_cycles y ON y.id = a.cycle_id JOIN misc_receipts m ON m.id = f.receipt_id
           LEFT JOIN users ur ON ur.id = f.requested_by LEFT JOIN users ud ON ud.id = f.decided_by
           LEFT JOIN users up ON up.id = f.paid_by
          WHERE ${where}
          ORDER BY f.requested_at DESC LIMIT 500`,
        params,
      )
    ).rows;
  }

  /** A refund as the screens show it, with its levels and what this viewer may do. */
  private async shape(c: PoolClient, ctx: RequestContext, x: Row) {
    const inst = x.instance_id ? await this.workflow.instanceWith(c, x.instance_id) : null;
    const pending =
      inst && inst.status === 'pending'
        ? inst.steps.find((s) => s.level === inst.currentLevel && s.status === 'pending')
        : undefined;
    const mine = pending && pending.assignees.some((p) => p.id === ctx.user.id) ? pending : null;
    return {
      id: x.id,
      applicationId: x.application_id,
      number: x.number,
      admissionNo: x.admission_no,
      candidate: x.candidate,
      className: x.class_name,
      session: x.session,
      receiptNo: x.receipt_no,
      paidAmount: Number(x.paid_amount),
      deductionPct: Number(x.deduction_pct),
      deduction: Number(x.deduction),
      amount: Number(x.amount),
      reason: x.reason,
      status: x.status,
      requestedAt: x.requested_at.toISOString(),
      requestedBy: x.requested_by,
      decidedAt: x.decided_at?.toISOString() ?? null,
      decidedBy: x.decided_by,
      decisionNote: x.decision_note,
      mode: x.mode,
      reference: x.reference,
      paidOn: x.paid_on,
      paidBy: x.paid_by,
      hasVoucher: x.status === 'paid',
      approval: inst
        ? {
            status: inst.status,
            waitingWith: pending
              ? `${pending.name}: ${pending.assignees.map((p) => p.name).join(', ') || 'nobody yet'}`
              : null,
            since: pending
              ? (inst.steps.find((s) => s.level === inst.currentLevel - 1)?.actedAt ??
                inst.requestedAt)
              : null,
            overdue: pending?.overdue ?? false,
            steps: inst.steps.map((s) => ({
              level: s.level,
              name: s.name,
              status: s.status,
              actedBy: s.actedBy,
              actedAt: s.actedAt,
              note: s.note,
            })),
          }
        : null,
      // the levels in force: the viewer's own level; switched off: a refund approver decides
      mayDecide:
        x.status === 'requested' &&
        (mine !== null || (!x.instance_id && ctx.permissions?.has(REFUND_APPROVE) === true)),
      mayPay: x.status === 'approved' && has(ctx, PAYERS),
    };
  }

  /** The levels exist (Fees → Approval lists and edits them). */
  async approvalFlow(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ active: await ensureRefundFlow(c) }));
  }

  async list(ctx: RequestContext, q: { status?: string; cycleId?: string; mine?: boolean }) {
    this.mayView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // refunds asked before the levels were switched on join them now (docs/design/54)
      if (await ensureRefundFlow(c)) {
        const waiting = await c.query<{ id: string }>(
          `SELECT id::text FROM admission_refunds WHERE status = 'requested' AND workflow_instance_id IS NULL`,
        );
        for (const w of waiting.rows) await startRefundFlow(this.workflow, c, ctx, w.id);
      }
      const rows = await this.rows(
        c,
        `($1::text IS NULL OR f.status = $1) AND ($2::bigint IS NULL OR a.cycle_id = $2::bigint)`,
        [q.status ?? null, q.cycleId ?? null],
      );
      const data = [];
      for (const x of rows) data.push(await this.shape(c, ctx, x));
      const counts = (
        await c.query<{ status: string; n: number }>(
          `SELECT status, count(*)::int AS n FROM admission_refunds GROUP BY status`,
        )
      ).rows;
      return {
        data: q.mine ? data.filter((r) => r.mayDecide) : data,
        counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
        levelsInUse: await ensureRefundFlow(c),
      };
    });
  }

  private async one(c: PoolClient, id: string) {
    const x = (await this.rows(c, `f.id = $1`, [id]))[0];
    if (!x) throw new DomainError('not-found', 'Refund not found', { status: 404 });
    return x;
  }

  /** Approve or reject: the viewer's level of the process, or (levels off) a refund approver at once. */
  async decide(ctx: RequestContext, id: string, dto: { approve: boolean; note?: string }) {
    this.mayView(ctx);
    if (!dto.approve && !dto.note?.trim())
      throw new DomainError('validation-failed', 'Give the reason for not approving', {
        status: 400,
      });
    const tenant = requireTenant(ctx);
    const step = await this.db.tenant(tenant, async (c) => {
      const x = await this.one(c, id);
      if (x.status !== 'requested')
        throw new DomainError('admissions.refund_decided', 'This refund is already decided', {
          status: 409,
        });
      if (x.instance_id) {
        const inst = await this.workflow.instanceWith(c, x.instance_id);
        const pending = inst?.steps.find(
          (s) => s.level === inst.currentLevel && s.status === 'pending',
        );
        if (!pending || !pending.assignees.some((p) => p.id === ctx.user.id))
          throw new DomainError(
            'workflow.not_assignee',
            `This refund waits at ${pending?.name ?? 'another level'}, not with you`,
            { status: 403 },
          );
        return pending.id;
      }
      if (!ctx.permissions?.has(REFUND_APPROVE))
        throw new DomainError('permission-denied', 'Only a refund approver decides this refund', {
          status: 403,
        });
      await this.settle(c, ctx, x, dto.approve ? 'approved' : 'rejected', dto.note ?? null);
      return null;
    });
    if (step)
      await this.workflow.act(ctx, step, dto.approve ? 'approved' : 'rejected', { note: dto.note });
    return this.db.tenant(tenant, async (c) => this.shape(c, ctx, await this.one(c, id)));
  }

  /** The levels are done (WorkflowService.onComplete): approved to pay, or not approved. */
  async onApprovalComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    const x = (await this.rows(c, `f.id = $1`, [instance.entityId]))[0];
    if (!x || x.status !== 'requested') return;
    const last = [...instance.steps].reverse().find((s) => s.status === outcome);
    await this.settle(c, ctx, x, outcome, last?.note ?? null);
  }

  private async settle(
    c: PoolClient,
    ctx: RequestContext,
    x: Row,
    outcome: 'approved' | 'rejected',
    note: string | null,
  ) {
    await c.query(
      `UPDATE admission_refunds SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
      [x.id, outcome, ctx.user.id, note],
    );
    await this.core.event(
      c,
      x.application_id,
      'cancelled',
      'cancelled',
      `Admission fee refund of ${money(Number(x.amount))} ${outcome === 'approved' ? 'approved: to pay' : 'not approved'}${note ? ` (${note})` : ''}`,
      { actorUser: ctx.user.id },
    );
    await this.notify(c, x, outcome === 'approved' ? 'approved' : 'not approved', note);
    await this.audit.stage(ctx, c, {
      action: outcome === 'approved' ? 'admissions.refund.approve' : 'admissions.refund.reject',
      entityType: 'admission_refunds',
      entityId: x.id,
      after: { note },
    });
  }

  /** The family hears of the refund (approved, not approved, paid). */
  private async notify(c: PoolClient, x: Row, state: string, note: string | null) {
    const amount = Number(x.amount).toLocaleString('en-IN');
    await c.query(`SELECT app.admission_notify($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9)`, [
      'admission_refund',
      x.contact_mobile,
      x.contact_email,
      JSON.stringify({
        ...messageTag('status', { applicationId: x.application_id }),
        name: x.candidate ?? '',
        number: x.admission_no ?? x.number ?? '',
        school: '',
        amount,
        state,
        note: note ?? '',
      }),
      `Admission fee refund ${state}`,
      `The refund of the admission fee of ${x.candidate ?? 'your ward'} is ${state}.`,
      money(Number(x.amount)),
      JSON.stringify([
        ['Candidate', x.candidate ?? ''],
        ['Registration no.', x.number ?? ''],
        ['Admission fee paid', money(Number(x.paid_amount))],
        [`Deduction (${String(Number(x.deduction_pct))}%)`, money(Number(x.deduction))],
        ['Refund', money(Number(x.amount))],
      ]),
      note ?? 'Contact the school office for any question about the refund.',
    ]);
  }

  /** Accounts pay the approved refund out: the voucher is made and kept with the registration. */
  async pay(
    ctx: RequestContext,
    id: string,
    dto: { mode: string; reference?: string; paidOn?: string },
  ) {
    if (!has(ctx, PAYERS))
      throw new DomainError(
        'permission-denied',
        'Only the cashier or a refund approver pays refunds',
        {
          status: 403,
        },
      );
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    if (dto.paidOn && dto.paidOn > today)
      throw new DomainError('validation-failed', 'The payment date cannot be in the future', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lock = await c.query<{ status: string }>(
        `SELECT status FROM admission_refunds WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!lock.rows[0]) throw new DomainError('not-found', 'Refund not found', { status: 404 });
      if (lock.rows[0].status !== 'approved')
        throw new DomainError('admissions.refund_not_approved', 'Approve the refund first', {
          status: 409,
        });
      if (dto.mode !== 'cash' && !dto.reference?.trim())
        throw new DomainError(
          'validation-failed',
          'Give the cheque no. or the transfer reference',
          {
            status: 400,
          },
        );
      await c.query(
        `UPDATE admission_refunds SET status = 'paid', mode = $2, reference = $3, paid_on = COALESCE($4::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), paid_by = $5 WHERE id = $1`,
        [id, dto.mode, dto.reference?.trim() || null, dto.paidOn ?? null, ctx.user.id],
      );
      const x = await this.one(c, id);
      const pdf = await this.voucherBytes(c, x);
      const file = await this.core.storePdf(c, x.application_id, `Refund-voucher-${id}.pdf`, pdf);
      if (file)
        await c.query(`UPDATE admission_refunds SET voucher_file_id = $2 WHERE id = $1`, [
          id,
          file.fileId,
        ]);
      await this.core.event(
        c,
        x.application_id,
        'cancelled',
        'cancelled',
        `Admission fee refund of ${money(Number(x.amount))} paid (${dto.mode}${dto.reference ? ` ${dto.reference}` : ''})`,
        { actorUser: ctx.user.id },
      );
      await this.notify(c, x, 'paid', dto.reference ? `Reference ${dto.reference}.` : null);
      await this.audit.stage(ctx, c, {
        action: 'admissions.refund.pay',
        entityType: 'admission_refunds',
        entityId: id,
        after: { mode: dto.mode, reference: dto.reference ?? null },
      });
      return this.shape(c, ctx, x);
    });
  }

  private async voucherBytes(c: PoolClient, x: Row) {
    const { head, logo } = await this.core.school(c);
    const d = x.paid_on ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    return admissionReceiptPdf({
      school: head,
      logo,
      title: 'Admission fee refund voucher',
      numberLabel: 'Voucher no.',
      receiptNo: `AR-${x.id}`,
      date: `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`,
      rows: [
        ['Candidate', x.candidate ?? ''],
        ['Class', `${x.class_name} (${x.session})`],
        ['Registration no.', x.number ?? ''],
        ['Admission fee receipt', x.receipt_no],
        ['Admission fee paid', money(Number(x.paid_amount))],
        [`Deduction (${String(Number(x.deduction_pct))}%)`, money(Number(x.deduction))],
        ['Reason', x.reason],
        ['Approved by', x.decided_by ?? ''],
        ['Paid by', `${(x.mode ?? '').toUpperCase()}${x.reference ? ` · ${x.reference}` : ''}`],
        ['Paid out by', x.paid_by ?? ''],
      ],
      amount: money(Number(x.amount)),
      words: `Rupees ${amountInWords(Number(x.amount)).replace(/\b[a-z]/g, (ch) => ch.toUpperCase())} Only`,
      note: 'Received the above refund of the admission fee. Signature of the parent: ____________________',
    });
  }

  /** The voucher of a paid refund (the copy kept at payment, else made again). */
  async voucher(ctx: RequestContext, id: string) {
    this.mayView(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.one(c, id);
      if (x.status !== 'paid')
        throw new DomainError('not-found', 'The voucher comes with the payment', { status: 404 });
      const kept = x.voucher_file_id ? await this.core.fileBytes(c, x.voucher_file_id) : null;
      return {
        filename: `Refund-voucher-AR-${id}.pdf`,
        contentType: 'application/pdf',
        base64: (kept?.bytes ?? (await this.voucherBytes(c, x))).toString('base64'),
      };
    });
  }
}
