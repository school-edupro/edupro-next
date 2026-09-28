import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { razorpay, razorpayCredentials } from './adapters';
import type { DecideRefundDto, ListRefundsQueryDto, RequestRefundDto } from './payments.dto';
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
}

const SELECT = `SELECT r.id::text, r.payment_id::text AS "paymentId", p.receipt_no AS "receiptNo", p.student_id::text AS "studentId", s.display_name AS "studentName", s.admission_no AS "admissionNo",
        p.amount::text AS "receiptAmount", r.amount::text, r.reason, r.mode, r.reference, r.status::text, ru.display_name AS "requestedBy", r.requested_at AS "requestedAt",
        du.display_name AS "decidedBy", r.decided_at AS "decidedAt", r.decision_note AS "decisionNote", r.provider, r.provider_ref AS "providerRef", r.paid_on::text AS "paidOn"
   FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id JOIN students s ON s.id = p.student_id
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
  ) {}

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
        where.push(`p.student_id = $${params.length}`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id WHERE ${whereSql}`,
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
      if (dto.amount > left + 0.005)
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
          `INSERT INTO fee_refunds (school_id, payment_id, amount, reason, mode, reference, requested_by, provider, request_id)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), $6, app.current_request_id()) RETURNING id::text`,
          [
            paymentId,
            dto.amount.toFixed(2),
            dto.reason,
            dto.mode,
            dto.reference ?? null,
            dto.mode === 'gateway' ? pay.provider : null,
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
      return this.find(c, id);
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideRefundDto): Promise<RefundRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
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
        if (before.mode === 'gateway') await this.refundThroughGateway(c, before);
        else {
          try {
            await c.query(`SELECT app.apply_fee_refund($1, true)`, [id]);
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
    });
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
        await c.query(`SELECT app.apply_fee_refund($1, true)`, [refund.id]);
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
        await c.query(`SELECT app.apply_fee_refund($1, $2)`, [
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
