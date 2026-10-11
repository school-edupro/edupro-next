import { amountInWords } from '@edupro/db';
import { schoolHead } from '../attendance/register-file';
import { receiptPdf } from '../fees/receipt-pdf';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { razorpay, razorpayCredentials } from './adapters';
import { WAITING_WITH, startFeeApproval } from '../fees/fee-approval';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import type {
  DecideRefundDto,
  ListRefundsQueryDto,
  RequestAdvanceRefundDto,
  RequestRefundDto,
} from './payments.dto';

/** The approval a refund rides; its levels mirror the fee change approval. */
export const FEE_REFUND_FLOW = 'fee_refund';
import { PaymentsService, translate } from './payments.service';

export interface RefundRow {
  id: string;
  paymentId: string;
  receiptNo: string | null;
  studentId: string;
  studentName: string;
  admissionNo: string;
  receiptAmount: string;
  amount: string;
  reason: string;
  mode: string;
  reference: string | null;
  status: 'requested' | 'approved' | 'rejected' | 'paid' | 'failed';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  provider: string | null;
  providerRef: string | null;
  paidOn: string | null;
  kind: 'receipt' | 'opening_advance';
  /** Head-wise lines; null = the whole amount taken back from the newest instalments. */
  lines: RefundLine[] | null;
  feeAction: 'due' | 'cancel';
  voucherNo: string | null;
  batchId: string | null;
  workflowInstanceId: string | null;
  waitingWith: string | null;
  /** Set when the system raised the refund on a withdrawal. */
  withdrawalId: string | null;
}
export interface RefundLine {
  part: 'fee' | 'advance' | 'late_fee';
  demandId?: string;
  head: string;
  period: string | null;
  amount: string;
}

// eslint-disable-next-line no-restricted-syntax -- WAITING_WITH is a fixed SQL fragment over a column name written here
const SELECT = `SELECT r.id::text, r.payment_id::text AS "paymentId", p.receipt_no AS "receiptNo", s.id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo",
        COALESCE(p.amount, 0)::text AS "receiptAmount", r.amount::text, r.reason, r.mode, r.reference, r.status::text, ru.display_name AS "requestedBy", r.requested_at AS "requestedAt",
        du.display_name AS "decidedBy", r.decided_at AS "decidedAt", r.decision_note AS "decisionNote", r.provider, r.provider_ref AS "providerRef", r.paid_on::text AS "paidOn",
        r.kind, r.lines, r.fee_action AS "feeAction", r.voucher_no AS "voucherNo", r.batch_id::text AS "batchId", r.workflow_instance_id::text AS "workflowInstanceId", r.withdrawal_id::text AS "withdrawalId",
        ${WAITING_WITH('r.workflow_instance_id')} AS "waitingWith"
   FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id JOIN students s ON s.id = COALESCE(r.student_id, p.student_id)
   LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by`;

const toRow = (x: Record<string, unknown>): RefundRow =>
  ({
    ...x,
    requestedAt: (x.requestedAt as Date).toISOString(),
    decidedAt: x.decidedAt ? (x.decidedAt as Date).toISOString() : null,
  }) as RefundRow;

/**
 * Sprint 13 refunds: the accounts desk requests, an administrator decides. An approved offline refund is
 * paid at approval (reference recorded); a gateway refund is sent to the provider that collected the money
 * and marked paid by its confirmation (immediately for the mock, by webhook for Razorpay). The ledger effect
 * is app.apply_fee_refund: advance first, then allocations newest first, then late fee postings.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly workflow: WorkflowService,
  ) {}

  /** A refund rides the levels of Fee setup -> Approval levels; refunds of one batch share the approval. */
  private async startApproval(
    c: PoolClient,
    ctx: RequestContext,
    ids: string[],
    subject: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const instanceId = await startFeeApproval(
      this.workflow,
      c,
      ctx,
      { code: FEE_REFUND_FLOW, name: 'Fee refund' },
      ids[0]!,
      subject,
      payload,
    );
    if (instanceId)
      await c.query(
        `UPDATE fee_refunds SET workflow_instance_id = $2 WHERE id = ANY($1::bigint[])`,
        [ids, instanceId],
      );
  }

  /**
   * A refund approved with "the fee is cancelled" is turned into "the fee stays due": the fee lines it
   * cancelled are asked again. For a refund sent with the wrong choice; the money side stays as it is.
   */
  async feeDueAgain(ctx: RequestContext, id: string, reason: string): Promise<RefundRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (
        before.status !== 'paid' ||
        before.feeAction !== 'cancel' ||
        !before.lines ||
        before.withdrawalId
      )
        throw new DomainError(
          'fees.refund_not_cancelling',
          'Only a paid refund that cancelled its fee (and was not raised by a withdrawal) can be changed',
          { status: 409 },
        );
      const r = await c.query<{ v: string }>(`SELECT app.refund_fee_due_again($1)::text AS v`, [
        id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'fees.refund.fee_due_again',
        entityType: 'fee_refunds',
        entityId: id,
        before: { feeAction: 'cancel' },
        after: { feeAction: 'due', askedAgain: r.rows[0]!.v, reason },
      });
      return this.find(c, id);
    });
  }

  /** The last level approved (or a level rejected): the refund (or every refund of its batch) is decided. */
  async onWorkflowComplete(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ): Promise<void> {
    const note = instance.steps.find((x) => x.status === outcome)?.note ?? undefined;
    const rows = await c.query<{ id: string }>(
      `SELECT r.id::text FROM fee_refunds r
        WHERE r.status = 'requested'
          AND (r.id = $1 OR r.batch_id = (SELECT batch_id FROM fee_refunds WHERE id = $1)) ORDER BY r.id`,
      [instance.entityId],
    );
    for (const r of rows.rows) await this.decideWith(c, ctx, r.id, { outcome, note });
  }

  /** What one receipt can still give back, head by head (with the receipt's advance and late fee). */
  async refundable(ctx: RequestContext, paymentId: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.refundableIn(c, paymentId));
  }

  private async refundableIn(c: PoolClient, paymentId: string) {
    {
      const p = await c.query<{
        id: string;
        receipt_no: string | null;
        student_id: string;
        student: string;
        admission_no: string;
        amount: string;
        refunded: string;
        late_fee: string;
        status: string;
        received_on: string;
        mode: string;
        provider: string | null;
        allocated: string;
      }>(
        `SELECT p.id::text, p.receipt_no, p.student_id::text, s.display_name AS student, s.admission_no, p.amount::text, p.refunded::text, p.late_fee::text,
                p.status, p.received_on::text, COALESCE(p.mode_label, p.mode) AS mode, i.provider,
                COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0)::text AS allocated
           FROM fee_payments p JOIN students s ON s.id = p.student_id LEFT JOIN payment_intents i ON i.id = p.intent_id WHERE p.id = $1`,
        [paymentId],
      );
      const pay = p.rows[0];
      if (!pay) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      const lines = await c.query<{
        demandId: string;
        headId: string;
        head: string;
        sequence: number;
        period: string;
        paid: string;
      }>(
        `SELECT d.id::text AS "demandId", h.id::text AS "headId", h.name AS head, fp.sequence, fp.name AS period, sum(a.amount)::text AS paid
           FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
          WHERE a.payment_id = $1 GROUP BY d.id, h.id, h.name, h.sort_order, fp.sequence, fp.name ORDER BY h.sort_order, fp.sequence`,
        [paymentId],
      );
      const advance = Math.max(
        Number(pay.amount) - Number(pay.refunded) - Number(pay.late_fee) - Number(pay.allocated),
        0,
      );
      return {
        paymentId: pay.id,
        receiptNo: pay.receipt_no,
        studentId: pay.student_id,
        studentName: pay.student,
        admissionNo: pay.admission_no,
        receivedOn: pay.received_on,
        mode: pay.mode,
        status: pay.status,
        amount: pay.amount,
        refunded: pay.refunded,
        lateFee: pay.late_fee,
        advance: advance.toFixed(2),
        gateway: pay.provider !== null && ['razorpay', 'mock'].includes(pay.provider),
        lines: lines.rows,
      };
    }
  }

  /**
   * The refund voucher: the refund (or every refund raised with it) as one paper, head by head, with
   * the mode it was paid by and who approved it.
   */
  async voucher(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const one = await this.find(c, id);
      const all = one.batchId
        ? (
            await c.query<Record<string, unknown>>(
              // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the batch is a bound parameter
              `${SELECT} WHERE r.batch_id = $1::uuid AND r.status NOT IN ('rejected') ORDER BY r.id`,
              [one.batchId],
            )
          ).rows.map(toRow)
        : [one];
      const school = await schoolHead(c);
      const st = await c.query<{ section: string | null; guardian: string | null; year: string }>(
        `SELECT (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = $1 ORDER BY e.id DESC LIMIT 1) AS section,
                (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = $1 AND g.deleted_at IS NULL ORDER BY (sg.relation = 'father') DESC, sg.is_primary DESC, sg.id LIMIT 1) AS guardian,
                (SELECT y.code FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id JOIN academic_years y ON y.id = COALESCE(r.academic_year_id, p.academic_year_id)
                  WHERE r.id = $2) AS year`,
        [one.studentId, id],
      );
      const lines = all.flatMap((r) =>
        (
          r.lines ?? [
            { part: 'fee' as const, head: 'Fee refunded', period: null, amount: r.amount },
          ]
        ).map((l) => ({
          head: l.head,
          period: [l.period, r.receiptNo ? `receipt ${r.receiptNo}` : null]
            .filter(Boolean)
            .join(' · '),
          amount: l.amount,
        })),
      );
      const total = all.reduce((a, r) => a + Number(r.amount), 0).toFixed(2);
      return {
        school,
        student: {
          id: one.studentId,
          name: one.studentName,
          admissionNo: one.admissionNo,
          section: st.rows[0]?.section ?? null,
          guardian: st.rows[0]?.guardian ?? null,
        },
        year: st.rows[0]?.year ?? '',
        voucherNo: one.voucherNo,
        status: one.status,
        paidOn: one.paidOn,
        requestedAt: one.requestedAt,
        amount: total,
        amountWords: amountInWords(total),
        mode: one.mode,
        reference: one.reference,
        reason: one.reason,
        feeAction: one.feeAction,
        kind: one.kind,
        requestedBy: one.requestedBy,
        approvedBy: one.decidedBy,
        lines,
      };
    });
  }

  /** The refund voucher as a PDF made at once (base64, streamed by the web app). */
  async voucherFile(ctx: RequestContext, id: string) {
    const v = await this.voucher(ctx, id);
    const bytes = await receiptPdf(
      {
        school: v.school,
        student: v.student,
        year: v.year,
        receiptNo: v.voucherNo ?? 'not paid yet',
        receivedOn: v.paidOn ?? v.requestedAt,
        amount: v.amount,
        amountWords: v.amountWords,
        lateFee: '0',
        advance: '0',
        refunded: '0',
        status: v.status === 'rejected' ? 'reversed' : 'posted',
        mode: v.mode,
        modeKind: 'voucher',
        feeType: 'school',
        reference: v.reference,
        instrumentNo: null,
        instrumentDate: null,
        bankName: null,
        remarks: `${v.reason}${v.approvedBy ? ` · Approved by ${v.approvedBy}` : ''}`,
        receivedBy: v.requestedBy,
        depositAccount: null,
        lines: v.lines,
      },
      [''],
      {
        title: 'Refund voucher',
        numberLabel: 'Voucher no.',
        totalLabel: 'Total refunded',
        paidLine: 'Refunded by',
        signLeft: 'Prepared by',
        signRight: "Receiver's signature",
      },
    );
    return {
      filename: `refund-${(v.voucherNo ?? id).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  /** What is left of last year's advance for a pupil, and whether a refund of it is already open. */
  async openingAdvance(ctx: RequestContext, studentId: string) {
    const yearId = requireTenant(ctx).academicYearId;
    if (!yearId) return { available: '0.00', open: false };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ v: string; open: boolean }>(
        `SELECT app.opening_advance_left($1, $2)::numeric(14,2)::text AS v,
                EXISTS (SELECT 1 FROM fee_refunds WHERE kind = 'opening_advance' AND student_id = $1 AND academic_year_id = $2 AND status IN ('requested', 'approved')) AS open`,
        [studentId, yearId],
      );
      return { available: r.rows[0]!.v, open: r.rows[0]!.open };
    });
  }

  /** A refund of credit carried from last year: no receipt of this year stands behind it. */
  async requestAdvance(ctx: RequestContext, dto: RequestAdvanceRefundDto): Promise<RefundRow> {
    const tenant = requireTenant(ctx);
    const yearId = tenant.academicYearId;
    if (!yearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const left = await c.query<{ v: string; name: string | null }>(
        `SELECT app.opening_advance_left($1, $2)::text AS v, (SELECT display_name FROM students WHERE id = $1 AND deleted_at IS NULL) AS name`,
        [dto.studentId, yearId],
      );
      if (!left.rows[0]?.name)
        throw new DomainError('not-found', 'Student not found', { status: 404 });
      if (dto.amount > Number(left.rows[0].v) + 0.005)
        throw new DomainError(
          'fees.refund_exceeds_advance',
          `Only ₹${Number(left.rows[0].v).toFixed(2)} of last year's advance is left`,
          { status: 409 },
        );
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_refunds (school_id, kind, student_id, academic_year_id, amount, reason, mode, reference, requested_by, request_id, lines)
           VALUES (app.current_school_id(), 'opening_advance', $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_request_id(), $7::jsonb) RETURNING id::text`,
          [
            dto.studentId,
            yearId,
            dto.amount.toFixed(2),
            dto.reason,
            dto.mode,
            dto.reference ?? null,
            JSON.stringify([
              {
                part: 'advance',
                head: 'Advance from last year',
                period: null,
                amount: dto.amount.toFixed(2),
              },
            ]),
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('fees.refund_open', 'A refund of the advance is already open', {
            status: 409,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.refund.request',
        entityType: 'fee_refunds',
        entityId: id,
        after: { kind: 'opening_advance', ...dto },
      });
      await this.startApproval(
        c,
        ctx,
        [id],
        `Refund of last year's advance: ${left.rows[0].name}: Rs. ${dto.amount.toFixed(2)}`,
        { kind: 'opening_advance', reason: dto.reason },
      );
      return this.find(c, id);
    });
  }

  async list(ctx: RequestContext, q: ListRefundsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`r.status = $${params.length}::refund_status`);
      }
      if (q.studentId) {
        params.push(q.studentId);
        where.push(`COALESCE(r.student_id, p.student_id) = $${params.length}`);
      }
      // the working year: refunds of that year's receipts
      const yearId = requireTenant(ctx).academicYearId;
      if (yearId) {
        params.push(yearId);
        where.push(`COALESCE(r.academic_year_id, p.academic_year_id) = $${params.length}`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY r.requested_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<RefundRow> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
      `${SELECT} WHERE r.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Refund not found', { status: 404 });
    return toRow(r.rows[0]);
  }

  async get(ctx: RequestContext, id: string): Promise<RefundRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
  }

  async request(ctx: RequestContext, paymentId: string, dto: RequestRefundDto): Promise<RefundRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const p = await c.query<{
        amount: string;
        refunded: string;
        status: string;
        year: string;
        provider: string | null;
      }>(
        `SELECT p.amount::text, p.refunded::text, p.status, p.academic_year_id::text AS year, i.provider
           FROM fee_payments p LEFT JOIN payment_intents i ON i.id = p.intent_id WHERE p.id = $1 FOR UPDATE OF p`,
        [paymentId],
      );
      const pay = p.rows[0];
      if (!pay) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [pay.year]);
      const left = Number(pay.amount) - Number(pay.refunded);
      // head-wise: every line is checked against what this receipt paid on it
      let lines: RefundLine[] | null = null;
      if (dto.lines) {
        const can = await this.refundableIn(c, paymentId);
        const byDemand = new Map(can.lines.map((l) => [l.demandId, l]));
        lines = [];
        for (const l of dto.lines) {
          if (l.amount <= 0) continue;
          if (l.part === 'fee') {
            const d = byDemand.get(l.demandId!);
            if (!d || l.amount > Number(d.paid) + 0.005)
              throw new DomainError(
                'fees.refund_line_exceeds',
                d
                  ? `Only ₹${Number(d.paid).toFixed(2)} of this receipt went to ${d.head} · ${d.period}`
                  : 'A fee line is not on this receipt',
                { status: 409 },
              );
            lines.push({
              part: 'fee',
              demandId: d.demandId,
              head: d.head,
              period: d.period,
              amount: l.amount.toFixed(2),
            });
          } else {
            const max = Number(l.part === 'advance' ? can.advance : can.lateFee);
            if (l.amount > max + 0.005)
              throw new DomainError(
                'fees.refund_line_exceeds',
                `Only ₹${max.toFixed(2)} of ${l.part === 'advance' ? 'advance' : 'late fee'} is on this receipt`,
                { status: 409 },
              );
            lines.push({
              part: l.part,
              head: l.part === 'advance' ? 'Advance on the receipt' : 'Late fee',
              period: null,
              amount: l.amount.toFixed(2),
            });
          }
        }
        if (lines.length === 0)
          throw new DomainError('validation-failed', 'Give an amount on at least one line', {
            status: 422,
          });
      }
      const amount = lines ? lines.reduce((a, l) => a + Number(l.amount), 0) : (dto.amount ?? 0);
      if (amount <= 0)
        throw new DomainError('validation-failed', 'Give the amount to refund', { status: 422 });
      if (amount > left + 0.005)
        throw new DomainError(
          'fees.refund_exceeds_receipt',
          `Only ₹${left.toFixed(2)} of this receipt can still be refunded`,
          { status: 409, extra: { available: left.toFixed(2) } },
        );
      if (dto.mode === 'gateway') {
        if (!pay.provider || !['razorpay', 'mock'].includes(pay.provider))
          throw new DomainError(
            'payments.refund_unsupported',
            'This receipt was not collected by a gateway that refunds online; refund by bank or cheque',
            { status: 409 },
          );
      }
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_refunds (school_id, payment_id, amount, reason, mode, reference, requested_by, provider, request_id, lines, fee_action)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), $6, app.current_request_id(), $7::jsonb, $8) RETURNING id::text`,
          [
            paymentId,
            amount.toFixed(2),
            dto.reason,
            dto.mode,
            dto.reference ?? null,
            dto.mode === 'gateway' ? pay.provider : null,
            lines ? JSON.stringify(lines) : null,
            dto.feeAction,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('fees.refund_open', 'A refund is already open for this receipt', {
            status: 409,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.refund.request',
        entityType: 'fee_refunds',
        entityId: id,
        after: { paymentId, ...dto },
      });
      const made = await this.find(c, id);
      await this.startApproval(
        c,
        ctx,
        [id],
        `Refund: ${made.studentName}: Rs. ${amount.toFixed(2)} of receipt ${made.receiptNo ?? ''}${lines ? ` (${lines.length} line${lines.length === 1 ? '' : 's'}, fee ${dto.feeAction === 'cancel' ? 'cancelled' : 'due again'})` : ''}`,
        { kind: 'receipt', reason: dto.reason, feeAction: dto.feeAction },
      );
      return this.find(c, id);
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideRefundDto): Promise<RefundRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.find(c, id);
      if (row.status === 'requested' && row.workflowInstanceId)
        throw new DomainError(
          'fees.refund_in_workflow',
          'This refund goes through the approval levels: approve it from My approvals',
          { status: 409 },
        );
      return this.decideWith(c, ctx, id, dto);
    });
  }

  private async decideWith(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    dto: { outcome: 'approved' | 'rejected'; note?: string; reference?: string },
  ): Promise<RefundRow> {
    {
      const before = await this.find(c, id);
      if (before.status !== 'requested')
        throw new DomainError('fees.refund_decided', 'This refund has already been decided', {
          status: 409,
        });
      if (dto.outcome === 'rejected') {
        await c.query(
          `UPDATE fee_refunds SET status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = $2 WHERE id = $1`,
          [id, dto.note ?? null],
        );
      } else {
        await c.query(
          `UPDATE fee_refunds SET status = 'approved', decided_by = app.current_user_id(), decided_at = now(), decision_note = $2,
                  reference = COALESCE($3, reference) WHERE id = $1`,
          [id, dto.note ?? null, dto.reference ?? null],
        );
        if (before.mode === 'gateway' && before.paymentId)
          await this.refundThroughGateway(c, before);
        else {
          try {
            await c.query(`SELECT app.apply_fee_refund_lines($1, true)`, [id]);
          } catch (error) {
            throw translate(error);
          }
        }
      }
      const after = await this.find(c, id);
      await this.audit.stage(ctx, c, {
        action: dto.outcome === 'approved' ? 'fees.refund.approve' : 'fees.refund.reject',
        entityType: 'fee_refunds',
        entityId: id,
        before: { status: before.status },
        after: {
          status: after.status,
          note: dto.note,
          reference: after.reference,
          providerRef: after.providerRef,
        },
      });
      return after;
    }
  }

  /** Sends the refund to the provider; the ledger reverses now, "paid" waits for the provider's word. */
  private async refundThroughGateway(c: PoolClient, refund: RefundRow): Promise<void> {
    const intent = await c.query<{ provider: string; provider_ref: string | null; id: string }>(
      `SELECT i.provider, i.provider_ref, i.id::text FROM payment_intents i JOIN fee_payments p ON p.intent_id = i.id WHERE p.id = $1`,
      [refund.paymentId],
    );
    const i = intent.rows[0];
    if (!i)
      throw new DomainError(
        'payments.refund_unsupported',
        'No gateway payment behind this receipt',
        { status: 409 },
      );
    if (i.provider === 'mock') {
      const ref = `MOCKRF${Date.now()}`;
      await c.query(`UPDATE fee_refunds SET provider = 'mock', provider_ref = $2 WHERE id = $1`, [
        refund.id,
        ref,
      ]);
      try {
        await c.query(`SELECT app.apply_fee_refund_lines($1, true)`, [refund.id]);
      } catch (error) {
        throw translate(error);
      }
      await c.query(
        `UPDATE payment_intents SET refunded = refunded + $2, updated_at = now() WHERE id = $1`,
        [i.id, refund.amount],
      );
      return;
    }
    if (i.provider === 'razorpay' && i.provider_ref) {
      let out: { id: string; status: string };
      try {
        out = await razorpay.createRefund(
          razorpayCredentials(this.env),
          { paymentId: i.provider_ref, amount: refund.amount, notes: { refundId: refund.id } },
          this.payments.gatewayFetch,
        );
      } catch (error) {
        this.logger.error(`razorpay refund failed for ${refund.id}: ${(error as Error).message}`);
        throw new DomainError(
          'payments.gateway_unavailable',
          'The gateway did not accept the refund; try again',
          {
            status: 502,
          },
        );
      }
      await c.query(
        `UPDATE fee_refunds SET provider = 'razorpay', provider_ref = $2 WHERE id = $1`,
        [refund.id, out.id],
      );
      try {
        await c.query(`SELECT app.apply_fee_refund_lines($1, $2)`, [
          refund.id,
          out.status === 'processed',
        ]);
      } catch (error) {
        throw translate(error);
      }
      await c.query(
        `UPDATE payment_intents SET refunded = refunded + $2, updated_at = now() WHERE id = $1`,
        [i.id, refund.amount],
      );
      return;
    }
    throw new DomainError(
      'payments.refund_unsupported',
      `${i.provider} refunds are made from the provider's dashboard; record the payout as a bank refund`,
      { status: 409 },
    );
  }

  /** Provider confirmation (refund.processed / refund.failed) inside the tenant transaction. */
  async onProviderRefund(
    c: PoolClient,
    ev: { provider: string; providerRef: string; status: 'success' | 'failure' | 'pending' },
  ): Promise<void> {
    if (ev.status === 'pending') return;
    await c.query(
      `UPDATE fee_refunds SET status = $3::refund_status, paid_on = CASE WHEN $3 = 'paid' THEN COALESCE(paid_on, CURRENT_DATE) ELSE paid_on END
        WHERE provider = $1 AND provider_ref = $2 AND status = 'approved'`,
      [ev.provider, ev.providerRef, ev.status === 'success' ? 'paid' : 'failed'],
    );
  }
}
