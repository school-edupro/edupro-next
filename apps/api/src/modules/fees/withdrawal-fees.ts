import type { PoolClient } from 'pg';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import type { WorkflowService } from '../workflow/workflow.service';
import { startFeeApproval } from './fee-approval';

export interface WithdrawalFeeResult {
  /** Unpaid fee of the months after the leaving month, taken off the bill. */
  cancelled: string;
  /** Refunds raised for approval: fee paid for later months, refundable heads, advance. */
  refunds: number;
  refundTotal: string;
  inApproval: boolean;
}

/**
 * The fee side of a completed withdrawal (called inside its transaction).
 *  1. The months after the leaving month are not charged: their unpaid fee is cancelled, so the bill
 *     of the pupil is zero from the next month on.
 *  2. What the family paid beyond that is raised as refunds, for approval through Fee setup ->
 *     Approval levels: fee paid for the later months, refundable heads (security deposit) of any month,
 *     advance lying on receipts, and what is left of last year's advance. One refund per receipt, all
 *     of one withdrawal sharing a batch, one approval and one voucher number. The refunded fee is
 *     cancelled, not asked again. The mode (bank transfer) can be changed by raising it afresh.
 */
export async function settleWithdrawalFees(
  workflow: WorkflowService,
  c: PoolClient,
  ctx: RequestContext,
  w: { id: string; studentId: string; leavingOn: string; yearId: string },
): Promise<WithdrawalFeeResult> {
  const AFTER = `make_date(fp.year, fp.month, 1) > date_trunc('month', $3::date)`;
  // 1. later months are not charged
  const cancel = await c.query<{ v: string }>(
    // eslint-disable-next-line no-restricted-syntax -- AFTER is a fixed fragment; values are bound parameters
    `WITH gone AS (
       UPDATE fee_demands d SET discount = d.discount + (d.net - d.paid), net = d.paid,
              status = CASE WHEN d.paid > 0 THEN 'paid' ELSE 'cancelled' END::fee_demand_status, updated_at = now()
         FROM fee_periods fp
        WHERE fp.id = d.period_id AND d.student_id = $1 AND d.academic_year_id = $2 AND ${AFTER}
          AND d.status IN ('pending', 'partial') AND d.net > d.paid
       RETURNING d.discount)
     SELECT COALESCE((SELECT sum(d2.net - d2.paid) FROM fee_demands d2 JOIN fee_periods fp ON fp.id = d2.period_id
                       WHERE d2.student_id = $1 AND d2.academic_year_id = $2 AND ${AFTER}
                         AND d2.status IN ('pending', 'partial') AND d2.net > d2.paid), 0)::numeric(14,2)::text AS v, (SELECT count(*) FROM gone) AS n`,
    [w.studentId, w.yearId, w.leavingOn],
  );
  // 2. what was paid beyond the leaving month, receipt by receipt
  const paidAhead = await c.query<{
    payment_id: string;
    lines: Array<{ part: string; demandId: string; head: string; period: string; amount: string }>;
    total: string;
  }>(
    // eslint-disable-next-line no-restricted-syntax -- AFTER is a fixed fragment; values are bound parameters
    `SELECT a.payment_id::text, sum(a.amount)::numeric(14,2)::text AS total,
            jsonb_agg(jsonb_build_object('part', 'fee', 'demandId', d.id::text, 'head', h.name, 'period', fp.name, 'amount', a.amount::numeric(14,2)::text)
                      ORDER BY fp.sequence, h.sort_order) AS lines
       FROM (SELECT payment_id, demand_id, sum(amount) AS amount FROM fee_payment_allocations GROUP BY payment_id, demand_id) a
       JOIN fee_payments p ON p.id = a.payment_id AND p.status IN ('posted', 'partly_refunded')
       JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
      WHERE d.student_id = $1 AND d.academic_year_id = $2 AND (${AFTER} OR h.refundable)
        AND NOT EXISTS (SELECT 1 FROM fee_refunds r WHERE r.payment_id = a.payment_id AND r.status IN ('requested', 'approved'))
      GROUP BY a.payment_id ORDER BY a.payment_id`,
    [w.studentId, w.yearId, w.leavingOn],
  );
  const advances = await c.query<{ payment_id: string; advance: string }>(
    `SELECT p.id::text AS payment_id,
            (p.amount - p.refunded - p.late_fee - COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0))::numeric(14,2)::text AS advance
       FROM fee_payments p
      WHERE p.student_id = $1 AND p.academic_year_id = $2 AND p.status IN ('posted', 'partly_refunded')
        AND NOT EXISTS (SELECT 1 FROM fee_refunds r WHERE r.payment_id = p.id AND r.status IN ('requested', 'approved'))`,
    [w.studentId, w.yearId],
  );
  const byPayment = new Map<
    string,
    Array<{ part: string; demandId?: string; head: string; period: string | null; amount: string }>
  >();
  for (const r of paidAhead.rows) byPayment.set(r.payment_id, [...r.lines]);
  for (const a of advances.rows) {
    if (Number(a.advance) <= 0) continue;
    const list = byPayment.get(a.payment_id) ?? [];
    list.push({ part: 'advance', head: 'Advance on the receipt', period: null, amount: a.advance });
    byPayment.set(a.payment_id, list);
  }
  const opening = await c.query<{ v: string; open: boolean; name: string }>(
    `SELECT app.opening_advance_left($1, $2)::numeric(14,2)::text AS v,
            EXISTS (SELECT 1 FROM fee_refunds WHERE kind = 'opening_advance' AND student_id = $1 AND academic_year_id = $2 AND status IN ('requested', 'approved')) AS open,
            (SELECT display_name FROM students WHERE id = $1) AS name`,
    [w.studentId, w.yearId],
  );
  const reason = `Withdrawal: leaving on ${w.leavingOn.split('-').reverse().join('-')}`;
  const batch = await c.query<{ id: string }>(`SELECT gen_random_uuid()::text AS id`);
  const ids: string[] = [];
  let total = 0;
  for (const [paymentId, lines] of byPayment) {
    const amount = lines.reduce((s, l) => s + Number(l.amount), 0);
    if (amount <= 0) continue;
    const r = await c.query<{ id: string }>(
      `INSERT INTO fee_refunds (school_id, payment_id, amount, reason, mode, requested_by, request_id, lines, fee_action, batch_id, withdrawal_id)
       VALUES (app.current_school_id(), $1, $2, $3, 'bank', app.current_user_id(), app.current_request_id(), $4::jsonb, 'cancel', $5::uuid, $6) RETURNING id::text`,
      [paymentId, amount.toFixed(2), reason, JSON.stringify(lines), batch.rows[0]!.id, w.id],
    );
    ids.push(r.rows[0]!.id);
    total += amount;
  }
  if (Number(opening.rows[0]?.v ?? 0) > 0 && !opening.rows[0]!.open) {
    const amount = Number(opening.rows[0]!.v);
    const r = await c.query<{ id: string }>(
      `INSERT INTO fee_refunds (school_id, kind, student_id, academic_year_id, amount, reason, mode, requested_by, request_id, lines, batch_id, withdrawal_id)
       VALUES (app.current_school_id(), 'opening_advance', $1, $2, $3, $4, 'bank', app.current_user_id(), app.current_request_id(), $5::jsonb, $6::uuid, $7) RETURNING id::text`,
      [
        w.studentId,
        w.yearId,
        amount.toFixed(2),
        reason,
        JSON.stringify([
          {
            part: 'advance',
            head: 'Advance from last year',
            period: null,
            amount: amount.toFixed(2),
          },
        ]),
        batch.rows[0]!.id,
        w.id,
      ],
    );
    ids.push(r.rows[0]!.id);
    total += amount;
  }
  let inApproval = false;
  if (ids.length > 0) {
    try {
      const instanceId = await startFeeApproval(
        workflow,
        c,
        ctx,
        { code: 'fee_refund', name: 'Fee refund' },
        ids[0]!,
        `Refund on withdrawal: ${opening.rows[0]?.name ?? ''}: Rs. ${total.toFixed(2)} (${ids.length} line${ids.length === 1 ? '' : 's'})`,
        { kind: 'withdrawal', withdrawalId: w.id, reason },
      );
      if (instanceId) {
        await c.query(
          `UPDATE fee_refunds SET workflow_instance_id = $2 WHERE id = ANY($1::bigint[])`,
          [ids, instanceId],
        );
        inApproval = true;
      }
    } catch (error) {
      // who completes a withdrawal may not be among the creators of fee requests: the refunds then wait
      // on Fees -> Refunds for a user with the refund approve right; the withdrawal is not held back
      if (!(error instanceof DomainError)) throw error;
    }
  }
  return {
    cancelled: cancel.rows[0]?.v ?? '0.00',
    refunds: ids.length,
    refundTotal: total.toFixed(2),
    inApproval,
  };
}
