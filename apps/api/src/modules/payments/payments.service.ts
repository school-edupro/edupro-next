import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import type { ListIntentsQueryDto, PayuWebhookDto, RecordOfflinePaymentDto } from './payments.dto';
import { buildRequest, mockResponse, money, verifyResponse, type PayuRequest } from './payu';

export interface IntentRow {
  id: string;
  purpose: 'admission_fee' | 'fee_instalment' | 'misc';
  entityType: string | null;
  entityId: string | null;
  amount: string;
  currency: string;
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
  provider: string;
  txnId: string;
  providerRef: string | null;
  payerName: string | null;
  payerEmail: string | null;
  payerMobile: string | null;
  returnUrl: string | null;
  succeededAt: string | null;
  failedReason: string | null;
  createdAt: string;
  events?: Array<{ id: string; kind: string; providerRef: string | null; createdAt: string }>;
}

/** Called when an intent succeeds; the owning module reacts (offer accepted, demand allocated). */
export type SuccessHandler = (
  c: PoolClient,
  intent: IntentRow,
  ctx?: RequestContext,
) => Promise<void>;

const COLS = `id::text, purpose::text, entity_type AS "entityType", entity_id::text AS "entityId", amount::text, currency, status::text, provider, txn_id AS "txnId",
  provider_ref AS "providerRef", payer_name AS "payerName", payer_email AS "payerEmail", payer_mobile AS "payerMobile", return_url AS "returnUrl",
  succeeded_at AS "succeededAt", failed_reason AS "failedReason", created_at AS "createdAt"`;

const toRow = (r: Record<string, unknown>): IntentRow =>
  ({
    ...r,
    succeededAt: r.succeededAt ? (r.succeededAt as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
  }) as IntentRow;

const publicTenant = (schoolId: string): TenantContext => ({
  schoolId,
  userId: null,
  allowedSchoolIds: [schoolId],
  academicYearId: null,
});

/**
 * Payments v0 (S9-02): intents, the PayU form, a signature-verified idempotent webhook, offline payments
 * for the accounts desk and a mock gateway for development. Success handlers per purpose are registered by
 * the owning modules.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly handlers = new Map<string, SuccessHandler>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  onSuccess(purpose: IntentRow['purpose'], handler: SuccessHandler): void {
    this.handlers.set(purpose, handler);
  }

  get mode(): 'mock' | 'test' | 'live' {
    return this.env.PAYU_MODE;
  }

  /** Creates an intent inside the caller's transaction. */
  async createIntent(
    c: PoolClient,
    input: {
      purpose: IntentRow['purpose'];
      entityType: string;
      entityId: string;
      ledger?: 'school' | 'admission' | 'misc' | 'hostel';
      amount: number;
      payer: { name: string; email: string; mobile: string };
      returnUrl: string;
      createdByUser?: string | null;
      createdByApplicant?: string | null;
      requestId?: string | null;
    },
  ): Promise<IntentRow> {
    const txnId = `EP${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString('hex').toUpperCase()}`;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `INSERT INTO payment_intents (school_id, purpose, entity_type, entity_id, ledger, amount, provider, txn_id, payer_name, payer_email, payer_mobile, return_url, created_by_user, created_by_applicant, request_id, expires_at)
       VALUES (app.current_school_id(), $1::payment_purpose, $2, $3, $4::ledger_type, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now() + interval '2 days')
       RETURNING ${COLS}`,
      [
        input.purpose,
        input.entityType,
        input.entityId,
        input.ledger ?? (input.purpose === 'admission_fee' ? 'admission' : 'school'),
        money(input.amount),
        this.env.PAYU_MODE === 'mock' ? 'mock' : 'payu',
        txnId,
        input.payer.name,
        input.payer.email,
        input.payer.mobile,
        input.returnUrl,
        input.createdByUser ?? null,
        input.createdByApplicant ?? null,
        input.requestId ?? null,
      ],
    );
    const row = toRow(r.rows[0]!);
    await c.query(
      `INSERT INTO payment_events (school_id, intent_id, kind, payload) VALUES (app.current_school_id(), $1, 'created', $2::jsonb)`,
      [row.id, JSON.stringify({ amount: row.amount, purpose: row.purpose })],
    );
    return row;
  }

  /** The fields the client auto-posts to the gateway (or to the mock endpoint in development). */
  gatewayForm(intent: IntentRow): {
    action: string;
    method: 'POST';
    fields: PayuRequest;
    mode: 'mock' | 'test' | 'live';
  } {
    const fields = buildRequest(
      {
        txnid: intent.txnId,
        amount: intent.amount,
        productinfo: `${intent.purpose}:${intent.entityType ?? ''}:${intent.entityId ?? ''}`,
        firstname: intent.payerName ?? 'Payer',
        email: intent.payerEmail ?? 'unknown@example.invalid',
        phone: intent.payerMobile ?? '',
        surl: `${this.env.PUBLIC_APP_URL}/api/payments/return`,
        furl: `${this.env.PUBLIC_APP_URL}/api/payments/return`,
        udf1: intent.id,
      },
      this.env.PAYU_KEY,
      this.env.PAYU_SALT,
    );
    return {
      action: this.env.PAYU_MODE === 'mock' ? '/api/v1/payments/payu/mock' : this.env.PAYU_BASE_URL,
      method: 'POST',
      fields,
      mode: this.env.PAYU_MODE,
    };
  }

  async findByTxn(c: PoolClient, txnId: string): Promise<IntentRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${COLS} FROM payment_intents WHERE txn_id = $1 FOR UPDATE`,
      [txnId],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * Gateway notification: verify the signature, refuse tampered amounts, apply once per (provider, ref,
   * status), then run the purpose's success handler. Anything unexpected is recorded and answered 200 so the
   * gateway stops retrying; the outcome column tells the operator what happened.
   */
  async handlePayuWebhook(
    body: PayuWebhookDto,
    source: 'webhook' | 'return' | 'mock',
  ): Promise<{
    outcome: string;
    intentId: string | null;
    status: string | null;
    returnUrl: string | null;
  }> {
    const lookup = await this.db.global(async (c) => {
      const r = await c.query<{ school_id: string; intent_id: string }>(
        `SELECT school_id::text, intent_id::text FROM app.payment_intent_lookup($1)`,
        [body.txnid],
      );
      return r.rows[0] ?? null;
    });
    if (!lookup) {
      this.logger.warn(`payu notification for unknown txnid ${body.txnid}`);
      return { outcome: 'unknown_txn', intentId: null, status: null, returnUrl: null };
    }
    const signatureOk = verifyResponse(body, this.env.PAYU_KEY, this.env.PAYU_SALT);
    const externalId = `${body.mihpayid ?? body.txnid}:${body.status}`;
    return this.db.tenant(publicTenant(lookup.school_id), async (c) => {
      const intent = await this.findByTxn(c, body.txnid);
      if (!intent) return { outcome: 'unknown_txn', intentId: null, status: null, returnUrl: null };
      let outcome: string;
      if (!signatureOk) outcome = 'rejected';
      else if (money(body.amount) !== money(intent.amount)) outcome = 'mismatch';
      else outcome = 'applied';
      const inserted = await c.query(
        `INSERT INTO payment_webhooks (school_id, provider, external_id, txn_id, signature_ok, payload, outcome)
         VALUES (app.current_school_id(), 'payu', $1, $2, $3, $4::jsonb, $5) ON CONFLICT (provider, external_id) DO NOTHING`,
        [externalId, body.txnid, signatureOk, JSON.stringify({ ...body, source }), outcome],
      );
      if (inserted.rowCount === 0) {
        await c.query(
          `INSERT INTO payment_events (school_id, intent_id, kind, provider_ref, payload) VALUES (app.current_school_id(), $1, 'replay', $2, $3::jsonb)`,
          [intent.id, body.mihpayid ?? null, JSON.stringify({ source })],
        );
        return {
          outcome: 'duplicate',
          intentId: intent.id,
          status: intent.status,
          returnUrl: intent.returnUrl,
        };
      }
      await c.query(
        `INSERT INTO payment_events (school_id, intent_id, kind, provider_ref, payload) VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb)`,
        [
          intent.id,
          outcome === 'applied' ? 'webhook' : `webhook_${outcome}`,
          body.mihpayid ?? null,
          JSON.stringify({ status: body.status, amount: body.amount, source }),
        ],
      );
      if (outcome !== 'applied')
        return { outcome, intentId: intent.id, status: intent.status, returnUrl: intent.returnUrl };
      if (intent.status === 'succeeded')
        return {
          outcome: 'duplicate',
          intentId: intent.id,
          status: intent.status,
          returnUrl: intent.returnUrl,
        };
      if (body.status.toLowerCase() === 'success') {
        await c.query(
          `UPDATE payment_intents SET status = 'succeeded', provider_ref = $2, succeeded_at = now(), updated_at = now() WHERE id = $1`,
          [intent.id, body.mihpayid ?? null],
        );
        const updated = {
          ...intent,
          status: 'succeeded' as const,
          providerRef: body.mihpayid ?? null,
        };
        const handler = this.handlers.get(intent.purpose);
        if (handler) await handler(c, updated);
        else this.logger.warn(`no success handler for purpose ${intent.purpose}`);
        return {
          outcome: 'applied',
          intentId: intent.id,
          status: 'succeeded',
          returnUrl: intent.returnUrl,
        };
      }
      await c.query(
        `UPDATE payment_intents SET status = 'failed', provider_ref = $2, failed_reason = $3, updated_at = now() WHERE id = $1 AND status <> 'succeeded'`,
        [intent.id, body.mihpayid ?? null, String(body.error_Message ?? body.status)],
      );
      return {
        outcome: 'applied',
        intentId: intent.id,
        status: 'failed',
        returnUrl: intent.returnUrl,
      };
    });
  }

  /** Development only: signs a gateway response for the intent and feeds it to the webhook handler. */
  async mockPay(txnId: string, outcome: 'success' | 'failure') {
    if (this.env.PAYU_MODE !== 'mock')
      throw new DomainError(
        'payments.mock_disabled',
        'The mock gateway is only available when PAYU_MODE=mock',
        { status: 404 },
      );
    const lookup = await this.db.global(async (c) => {
      const r = await c.query<{ school_id: string }>(
        `SELECT school_id::text FROM app.payment_intent_lookup($1)`,
        [txnId],
      );
      return r.rows[0] ?? null;
    });
    if (!lookup) throw new DomainError('not-found', 'Unknown transaction');
    const intent = await this.db.tenant(publicTenant(lookup.school_id), (c) =>
      this.findByTxn(c, txnId),
    );
    if (!intent) throw new DomainError('not-found', 'Unknown transaction');
    const form = this.gatewayForm(intent);
    const response = mockResponse(form.fields, outcome, this.env.PAYU_KEY, this.env.PAYU_SALT);
    const result = await this.handlePayuWebhook(response as unknown as PayuWebhookDto, 'mock');
    return { ...result, response, returnUrl: intent.returnUrl };
  }

  // ---- staff side --------------------------------------------------------------------------------
  async list(
    ctx: RequestContext,
    q: ListIntentsQueryDto,
  ): Promise<{ rows: IntentRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      if (q.status) {
        params.push(q.status);
        where.push(`status = $${params.length}::payment_status`);
      }
      if (q.purpose) {
        params.push(q.purpose);
        where.push(`purpose = $${params.length}::payment_purpose`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM payment_intents WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; whereSql holds fixed fragments; values are bound parameters
        `SELECT ${COLS} FROM payment_intents WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async get(ctx: RequestContext, id: string): Promise<IntentRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${COLS} FROM payment_intents WHERE id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Payment intent not found');
      const row = toRow(r.rows[0]);
      const ev = await c.query<{
        id: string;
        kind: string;
        provider_ref: string | null;
        created_at: Date;
      }>(
        `SELECT id::text, kind, provider_ref, created_at FROM payment_events WHERE intent_id = $1 ORDER BY id`,
        [id],
      );
      row.events = ev.rows.map((e) => ({
        id: e.id,
        kind: e.kind,
        providerRef: e.provider_ref,
        createdAt: e.created_at.toISOString(),
      }));
      return row;
    });
  }

  /** Cash, cheque, UPI or bank payment recorded at the counter and allocated to the student's dues. */
  async recordOffline(ctx: RequestContext, dto: RecordOfflinePaymentDto) {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      const s = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        dto.studentId,
      ]);
      if (s.rowCount === 0) throw new DomainError('not-found', 'Student not found');
      const p = await c.query<{ id: string }>(
        `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, reference, remarks, received_by)
         VALUES (app.current_school_id(), $1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, app.current_user_id()) RETURNING id::text`,
        [
          dto.studentId,
          tenant.academicYearId,
          money(dto.amount),
          dto.receivedOn ?? null,
          dto.mode,
          dto.reference ?? null,
          dto.remarks ?? null,
        ],
      );
      const receiptNo = await this.numberReceipt(c, p.rows[0]!.id, true);
      const left = await c.query<{ left: string }>(
        `SELECT app.allocate_fee_payment($1)::text AS left`,
        [p.rows[0]!.id],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.offline.record',
        entityType: 'fee_payments',
        entityId: p.rows[0]!.id,
        after: { ...dto, receiptNo, unallocated: left.rows[0]!.left },
      });
      return {
        paymentId: p.rows[0]!.id,
        receiptNo,
        amount: money(dto.amount),
        unallocated: left.rows[0]!.left,
      };
    });
  }

  /** Online instalment payment started by the accounts desk (a parent-facing flow arrives with Phase 3). */
  async createFeeIntent(
    ctx: RequestContext,
    dto: {
      studentId: string;
      amount: number;
      payerName: string;
      payerEmail: string;
      payerMobile: string;
    },
  ) {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      const s = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        dto.studentId,
      ]);
      if (s.rowCount === 0) throw new DomainError('not-found', 'Student not found');
      const intent = await this.createIntent(c, {
        purpose: 'fee_instalment',
        entityType: 'student',
        entityId: dto.studentId,
        amount: dto.amount,
        payer: { name: dto.payerName, email: dto.payerEmail, mobile: dto.payerMobile },
        returnUrl: `${this.env.ADMIN_APP_URL}/fees/payments`,
        createdByUser: ctx.user.id,
        requestId: ctx.requestId,
      });
      await c.query(
        `UPDATE payment_intents SET meta = jsonb_build_object('academicYearId', $2::text) WHERE id = $1`,
        [intent.id, tenant.academicYearId],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.intent.create',
        entityType: 'payment_intents',
        entityId: intent.id,
        after: { studentId: dto.studentId, amount: intent.amount },
      });
      return { intent, form: this.gatewayForm(intent) };
    });
  }

  /** Success of a fee instalment intent: record the payment and allocate it to the student's demands. */
  async applyFeeInstalment(c: PoolClient, intent: IntentRow): Promise<void> {
    const meta = await c.query<{ year: string | null }>(
      `SELECT meta->>'academicYearId' AS year FROM payment_intents WHERE id = $1`,
      [intent.id],
    );
    const yearId =
      meta.rows[0]?.year ??
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`,
        )
      ).rows[0]?.id;
    if (!yearId || !intent.entityId) return;
    const p = await c.query<{ id: string }>(
      `INSERT INTO fee_payments (school_id, student_id, academic_year_id, intent_id, amount, mode, reference)
       VALUES (app.current_school_id(), $1, $2, $3, $4, 'online', $5) RETURNING id::text`,
      [intent.entityId, yearId, intent.id, intent.amount, intent.providerRef],
    );
    await this.numberReceipt(c, p.rows[0]!.id, false);
    await c.query(`SELECT app.allocate_fee_payment($1)`, [p.rows[0]!.id]);
  }

  /**
   * Sprint 12: every payment gets a receipt number from app.next_receipt_no (row-locked sequence per school,
   * ledger and financial year). Counter receipts refuse a date outside any financial year; gateway payments
   * fall back to the financial year of today so a webhook never fails on numbering.
   */
  private async numberReceipt(
    c: PoolClient,
    paymentId: string,
    strict: boolean,
  ): Promise<string | null> {
    const fy = await c.query<{ fy: string | null }>(
      `SELECT COALESCE(app.financial_year_for(p.received_on), CASE WHEN $2::boolean THEN NULL ELSE app.financial_year_for(CURRENT_DATE) END)::text AS fy
         FROM fee_payments p WHERE p.id = $1`,
      [paymentId, strict],
    );
    const fyId = fy.rows[0]?.fy ?? null;
    if (!fyId) {
      if (strict)
        throw new DomainError(
          'fees.no_financial_year',
          'No financial year covers the receipt date; create it under System → Years',
          { status: 409 },
        );
      this.logger.warn(`no financial year for payment ${paymentId}; receipt left unnumbered`);
      return null;
    }
    const r = await c.query<{ no: string }>(
      `UPDATE fee_payments SET financial_year_id = $2, receipt_no = app.next_receipt_no(ledger, $2) WHERE id = $1 RETURNING receipt_no AS no`,
      [paymentId, fyId],
    );
    return r.rows[0]?.no ?? null;
  }
}
