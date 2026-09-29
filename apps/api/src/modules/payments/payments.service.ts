import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { assertPeriodOpen } from '../ops/ops.service';
import { FeeLedgerService } from '../fees/fee-ledger.service';
import {
  ccavenue,
  ccavenueCredentials,
  razorpay,
  razorpayCredentials,
  type Checkout,
  type Notification,
} from './adapters';
import {
  PROVIDERS,
  type CcavenueReturnDto,
  type CreateFamilyIntentDto,
  type ListIntentsQueryDto,
  type PayuWebhookDto,
  type PostReceiptDto,
  type Provider,
  type RazorpayReturnDto,
  type RazorpayWebhookDto,
  type RecordOfflinePaymentDto,
} from './payments.dto';
import { buildRequest, mockResponse, money, verifyResponse, type PayuRequest } from './payu';

export interface IntentRow {
  id: string;
  purpose: 'admission_fee' | 'fee_instalment' | 'misc';
  entityType: string | null;
  entityId: string | null;
  amount: string;
  currency: string;
  status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
  provider: Provider;
  txnId: string;
  providerRef: string | null;
  providerOrderId: string | null;
  refunded: string;
  payerName: string | null;
  payerEmail: string | null;
  payerMobile: string | null;
  returnUrl: string | null;
  succeededAt: string | null;
  failedReason: string | null;
  createdAt: string;
  events?: Array<{ id: string; kind: string; providerRef: string | null; createdAt: string }>;
}

/** Called when an intent succeeds; the owning module reacts (offer accepted, receipt posted). */
export type SuccessHandler = (
  c: PoolClient,
  intent: IntentRow,
  ctx?: RequestContext,
) => Promise<void>;

/** Called when a provider reports a refund outcome (Sprint 13); the refunds service reacts. */
export type RefundEventHandler = (
  c: PoolClient,
  event: { provider: Provider; providerRef: string; status: 'success' | 'failure' | 'pending' },
) => Promise<void>;

export interface ReceiptResult {
  paymentId: string;
  receiptNo: string | null;
  amount: string;
  principal: string;
  lateFee: string;
  advance: string;
  instalments: number;
  /** kept for the Sprint 9 clients of /payments/offline */
  unallocated: string;
}

const COLS = `id::text, purpose::text, entity_type AS "entityType", entity_id::text AS "entityId", amount::text, currency, status::text, provider, txn_id AS "txnId",
  provider_ref AS "providerRef", provider_order_id AS "providerOrderId", refunded::text, payer_name AS "payerName", payer_email AS "payerEmail", payer_mobile AS "payerMobile", return_url AS "returnUrl",
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

const originOf = (url: string | null, fallback: string): string => {
  try {
    return url ? new URL(url).origin : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Payments (S9-02, S13): intents, gateway adapters (PayU, Razorpay, CCAvenue and the development mock), a
 * signature-verified idempotent notification path shared by every provider, receipts posted through
 * app.post_receipt at the counter and on gateway success, and a family's own online payment. Success
 * handlers per purpose are registered by the owning modules.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly handlers = new Map<string, SuccessHandler>();
  private refundHandler: RefundEventHandler | null = null;
  /** Network calls to the gateways go through here so tests can stand in for the provider. */
  gatewayFetch: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly ledger: FeeLedgerService,
  ) {}

  onSuccess(purpose: IntentRow['purpose'], handler: SuccessHandler): void {
    this.handlers.set(purpose, handler);
  }

  onRefundEvent(handler: RefundEventHandler): void {
    this.refundHandler = handler;
  }

  get mode(): 'mock' | 'test' | 'live' {
    return this.env.PAYU_MODE;
  }

  /** The school's gateway (setting payments.gateway) or the deployment default; mock stays mock. */
  async providerFor(c: PoolClient): Promise<Provider> {
    const r = await c.query<{ v: string | null }>(
      `SELECT app.setting('payments.gateway') #>> '{}' AS v`,
    );
    const v = r.rows[0]?.v;
    if (v && (PROVIDERS as readonly string[]).includes(v)) return v as Provider;
    return this.env.PAYMENT_PROVIDER;
  }

  private modeOf(provider: Provider): 'mock' | 'test' | 'live' {
    if (provider === 'mock') return 'mock';
    if (provider === 'payu') return this.env.PAYU_MODE === 'mock' ? 'test' : this.env.PAYU_MODE;
    return 'live';
  }

  /** Creates an intent inside the caller's transaction (and the provider's order when it needs one). */
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
    const provider = await this.providerFor(c);
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
        provider,
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
    let row = toRow(r.rows[0]!);
    if (provider === 'razorpay') {
      let order: razorpay.RazorpayOrder;
      try {
        order = await razorpay.createOrder(
          razorpayCredentials(this.env),
          { amount: row.amount, receipt: txnId, notes: { txnId, intentId: row.id } },
          this.gatewayFetch,
        );
      } catch (error) {
        this.logger.error(`razorpay order failed for ${txnId}: ${(error as Error).message}`);
        throw new DomainError(
          'payments.gateway_unavailable',
          'The payment gateway did not accept the order; try again in a moment',
          { status: 502 },
        );
      }
      const u = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `UPDATE payment_intents SET provider_order_id = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
        [row.id, order.id],
      );
      row = toRow(u.rows[0]!);
    }
    await c.query(
      `INSERT INTO payment_events (school_id, intent_id, kind, payload) VALUES (app.current_school_id(), $1, 'created', $2::jsonb)`,
      [row.id, JSON.stringify({ amount: row.amount, purpose: row.purpose, provider })],
    );
    return row;
  }

  /** What the browser needs to pay: an auto-posted form (PayU, CCAvenue, mock) or the Razorpay checkout. */
  checkout(intent: IntentRow): Checkout {
    const origin = originOf(intent.returnUrl, this.env.PUBLIC_APP_URL);
    const returnEndpoint = (provider: Provider) =>
      `${origin}/api/payments/return?provider=${provider}`;
    if (intent.provider === 'razorpay') {
      if (!intent.providerOrderId)
        throw new DomainError('payments.order_missing', 'The gateway order was not created', {
          status: 409,
        });
      return {
        kind: 'razorpay',
        provider: 'razorpay',
        mode: 'live',
        keyId: this.env.RAZORPAY_KEY_ID,
        orderId: intent.providerOrderId,
        amount: razorpay.toPaise(intent.amount),
        currency: 'INR',
        name: 'School fees',
        description: `${intent.purpose} ${intent.txnId}`,
        prefill: {
          name: intent.payerName ?? '',
          email: intent.payerEmail ?? '',
          contact: intent.payerMobile ?? '',
        },
        notes: { txnId: intent.txnId, intentId: intent.id },
        callbackUrl: returnEndpoint('razorpay'),
        returnUrl: intent.returnUrl,
      };
    }
    if (intent.provider === 'ccavenue') {
      const form = ccavenue.buildForm(
        {
          merchant_id: this.env.CCAVENUE_MERCHANT_ID,
          order_id: intent.txnId,
          amount: money(intent.amount),
          currency: 'INR',
          redirect_url: returnEndpoint('ccavenue'),
          cancel_url: returnEndpoint('ccavenue'),
          language: 'EN',
          billing_name: intent.payerName ?? 'Payer',
          billing_email: intent.payerEmail ?? '',
          billing_tel: intent.payerMobile ?? '',
          merchant_param1: intent.id,
          merchant_param2: intent.purpose,
        },
        ccavenueCredentials(this.env),
      );
      return { ...form, provider: 'ccavenue', mode: 'live' };
    }
    // PayU and the development mock share the PayU field set
    const fields: PayuRequest = buildRequest(
      {
        txnid: intent.txnId,
        amount: intent.amount,
        productinfo: `${intent.purpose}:${intent.entityType ?? ''}:${intent.entityId ?? ''}`,
        firstname: intent.payerName ?? 'Payer',
        email: intent.payerEmail ?? 'unknown@example.invalid',
        phone: intent.payerMobile ?? '',
        surl: returnEndpoint('payu'),
        furl: returnEndpoint('payu'),
        udf1: intent.id,
      },
      this.env.PAYU_KEY,
      this.env.PAYU_SALT,
    );
    const mock = intent.provider === 'mock';
    return {
      kind: 'form',
      provider: intent.provider,
      mode: mock ? 'mock' : this.modeOf('payu'),
      action: mock ? '/api/v1/payments/payu/mock' : this.env.PAYU_BASE_URL,
      method: 'POST',
      fields: fields as unknown as Record<string, string>,
    };
  }

  /** Sprint 9 name kept for the admissions module and the public app. */
  gatewayForm(intent: IntentRow): Checkout {
    return this.checkout(intent);
  }

  async findByTxn(c: PoolClient, txnId: string): Promise<IntentRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${COLS} FROM payment_intents WHERE txn_id = $1 FOR UPDATE`,
      [txnId],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  // ---- notifications ------------------------------------------------------------------------------
  /**
   * Every provider's notification lands here: find the intent across tenants by our transaction id or the
   * provider's order id, refuse a bad signature or a tampered amount, apply once per (provider, reference,
   * status), then run the purpose's success handler. Anything unexpected is recorded and answered 200 so the
   * gateway stops retrying; the outcome column tells the operator what happened.
   */
  async applyNotification(
    n: Notification,
    source: 'webhook' | 'return' | 'mock',
  ): Promise<{
    outcome: string;
    intentId: string | null;
    status: string | null;
    returnUrl: string | null;
  }> {
    const lookup = await this.db.global(async (c) => {
      if (n.txnId) {
        const r = await c.query<{ school_id: string; intent_id: string; txn_id?: string }>(
          `SELECT school_id::text, intent_id::text FROM app.payment_intent_lookup($1)`,
          [n.txnId],
        );
        if (r.rows[0]) return { ...r.rows[0], txn_id: n.txnId };
      }
      if (n.orderId) {
        const r = await c.query<{ school_id: string; intent_id: string; txn_id: string }>(
          `SELECT school_id::text, intent_id::text, txn_id FROM app.payment_intent_lookup_by_order($1, $2)`,
          [n.provider, n.orderId],
        );
        if (r.rows[0]) return r.rows[0];
      }
      return null;
    });
    if (!lookup) {
      this.logger.warn(
        `${n.provider} notification for unknown transaction ${n.txnId ?? n.orderId ?? '?'} (${source})`,
      );
      return { outcome: 'unknown_txn', intentId: null, status: null, returnUrl: null };
    }
    // A forged notification must not consume the idempotency key of the genuine one that may follow
    // (found by the Sprint 13 e2e: a bad-signature return answered first made the real return "duplicate").
    const base = `${n.providerRef ?? lookup.txn_id}:${n.status}`;
    const externalId = n.signatureOk
      ? base
      : `${base}:rejected:${Date.now()}:${randomBytes(3).toString('hex')}`;
    return this.db.tenant(publicTenant(lookup.school_id), async (c) => {
      const intent = await this.findByTxn(c, lookup.txn_id!);
      if (!intent) return { outcome: 'unknown_txn', intentId: null, status: null, returnUrl: null };
      let outcome: string;
      if (!n.signatureOk) outcome = 'rejected';
      else if (n.amount !== null && money(n.amount) !== money(intent.amount)) outcome = 'mismatch';
      else if (n.status === 'pending') outcome = 'ignored';
      else outcome = 'applied';
      const inserted = await c.query(
        `INSERT INTO payment_webhooks (school_id, provider, external_id, txn_id, signature_ok, payload, outcome)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (provider, external_id) DO NOTHING`,
        [
          n.provider,
          externalId,
          intent.txnId,
          n.signatureOk,
          JSON.stringify({ ...(n.payload as object), source }),
          outcome,
        ],
      );
      if (inserted.rowCount === 0) {
        await c.query(
          `INSERT INTO payment_events (school_id, intent_id, kind, provider_ref, payload) VALUES (app.current_school_id(), $1, 'replay', $2, $3::jsonb)`,
          [intent.id, n.providerRef, JSON.stringify({ source, provider: n.provider })],
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
          n.providerRef,
          JSON.stringify({ status: n.status, amount: n.amount, source, provider: n.provider }),
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
      if (n.status === 'success') {
        await c.query(
          `UPDATE payment_intents SET status = 'succeeded', provider_ref = $2, succeeded_at = now(), updated_at = now() WHERE id = $1`,
          [intent.id, n.providerRef],
        );
        const updated = { ...intent, status: 'succeeded' as const, providerRef: n.providerRef };
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
        [intent.id, n.providerRef, n.reason ?? 'failed'],
      );
      return {
        outcome: 'applied',
        intentId: intent.id,
        status: 'failed',
        returnUrl: intent.returnUrl,
      };
    });
  }

  /** PayU: server notification, browser return and the mock all carry the signed PayU field set. */
  async handlePayuWebhook(body: PayuWebhookDto, source: 'webhook' | 'return' | 'mock') {
    // the mock speaks PayU, so its notifications share PayU's idempotency keys (a replayed mock success is a replay)
    return this.applyNotification(
      {
        provider: 'payu',
        txnId: body.txnid,
        orderId: null,
        providerRef: body.mihpayid ?? null,
        status: body.status.toLowerCase() === 'success' ? 'success' : 'failure',
        amount: body.amount,
        signatureOk: verifyResponse(body, this.env.PAYU_KEY, this.env.PAYU_SALT),
        reason: String(body.error_Message ?? body.status),
        payload: body,
      },
      source,
    );
  }

  /** Razorpay checkout handler / return: HMAC over order id and payment id. Only successes come this way. */
  async handleRazorpayReturn(body: RazorpayReturnDto) {
    return this.applyNotification(
      {
        provider: 'razorpay',
        txnId: null,
        orderId: body.razorpay_order_id,
        providerRef: body.razorpay_payment_id,
        status: 'success',
        amount: null,
        signatureOk: razorpay.verifyCheckout(body, this.env.RAZORPAY_KEY_SECRET),
        reason: null,
        payload: body,
      },
      'return',
    );
  }

  /** Razorpay webhook: HMAC over the raw body; payment.* events settle intents, refund.* events settle refunds. */
  async handleRazorpayWebhook(
    rawBody: string | Buffer,
    signature: string | undefined,
    body: RazorpayWebhookDto,
  ) {
    const signatureOk = razorpay.verifyWebhook(
      rawBody,
      signature,
      this.env.RAZORPAY_WEBHOOK_SECRET,
    );
    const ev = razorpay.readWebhook(body as unknown as razorpay.RazorpayWebhookEvent);
    if (ev.kind === 'refund') {
      if (!signatureOk) {
        this.logger.warn(`razorpay refund webhook with a bad signature (${ev.refundId ?? '?'})`);
        return { outcome: 'rejected', intentId: null, status: null, returnUrl: null };
      }
      if (!this.refundHandler || !ev.refundId)
        return { outcome: 'ignored', intentId: null, status: null, returnUrl: null };
      const lookup = await this.db.global(async (c) => {
        const r = await c.query<{ school_id: string }>(
          `SELECT school_id::text FROM app.refund_lookup('razorpay', $1)`,
          [ev.refundId],
        );
        return r.rows[0] ?? null;
      });
      if (!lookup)
        return { outcome: 'unknown_refund', intentId: null, status: null, returnUrl: null };
      await this.db.tenant(publicTenant(lookup.school_id), (c) =>
        this.refundHandler!(c, {
          provider: 'razorpay',
          providerRef: ev.refundId!,
          status: ev.status,
        }),
      );
      return { outcome: 'applied', intentId: null, status: ev.status, returnUrl: null };
    }
    if (ev.kind !== 'payment')
      return { outcome: 'ignored', intentId: null, status: null, returnUrl: null };
    return this.applyNotification(
      {
        provider: 'razorpay',
        txnId: null,
        orderId: ev.orderId,
        providerRef: ev.paymentId,
        status: ev.status,
        amount: ev.amount,
        signatureOk,
        reason: ev.reason,
        payload: body,
      },
      'webhook',
    );
  }

  /** CCAvenue redirect and cancel URLs: the encrypted response must open with the working key. */
  async handleCcavenueReturn(body: CcavenueReturnDto) {
    const resp = ccavenue.readResponse(body.encResp, this.env.CCAVENUE_WORKING_KEY);
    if (!resp) {
      this.logger.warn('ccavenue response did not decrypt with the working key');
      return { outcome: 'rejected', intentId: null, status: null, returnUrl: null };
    }
    return this.applyNotification(
      {
        provider: 'ccavenue',
        txnId: resp.order_id,
        orderId: null,
        providerRef: resp.tracking_id,
        status: ccavenue.outcomeOf(resp.order_status),
        amount: resp.amount,
        signatureOk: true,
        reason: resp.failure_message ?? resp.status_message ?? resp.order_status,
        payload: resp,
      },
      'return',
    );
  }

  /** Development only: signs a gateway response for the intent and feeds it to the notification path. */
  async mockPay(txnId: string, outcome: 'success' | 'failure') {
    if (this.env.PAYU_MODE !== 'mock' && this.env.PAYMENT_PROVIDER !== 'mock')
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
    if (intent.provider !== 'mock' && intent.provider !== 'payu')
      throw new DomainError('payments.mock_disabled', 'This intent belongs to a real gateway', {
        status: 409,
      });
    const form = this.checkout({ ...intent, provider: 'mock' });
    if (form.kind !== 'form') throw new DomainError('payments.mock_disabled', 'Not a form intent');
    const response = mockResponse(
      form.fields as unknown as PayuRequest,
      outcome,
      this.env.PAYU_KEY,
      this.env.PAYU_SALT,
    );
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

  private yearOf(ctx: RequestContext): { tenant: TenantContext; yearId: string } {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return { tenant, yearId: tenant.academicYearId };
  }

  private async post(
    c: PoolClient,
    input: {
      studentId: string;
      yearId: string;
      amount: number | string;
      receivedOn: string | null;
      mode: string;
      reference: string | null;
      remarks: string | null;
      instrumentNo: string | null;
      instrumentDate: string | null;
      bankName: string | null;
      intentId: string | null;
      ledger: string;
      collectLateFee: boolean;
      strictYear: boolean;
    },
  ): Promise<ReceiptResult> {
    const r = await c.query<{
      o_payment_id: string;
      o_receipt_no: string | null;
      o_principal: string;
      o_late_fee: string;
      o_advance: string;
      o_instalments: number;
    }>(
      `SELECT o_payment_id::text, o_receipt_no, o_principal::text, o_late_fee::text, o_advance::text, o_instalments
         FROM app.post_receipt($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8, $9::date, $10, $11, $12::ledger_type, $13, $14)`,
      [
        input.studentId,
        input.yearId,
        money(input.amount),
        input.receivedOn,
        input.mode,
        input.reference,
        input.remarks,
        input.instrumentNo,
        input.instrumentDate,
        input.bankName,
        input.intentId,
        input.ledger,
        input.collectLateFee,
        input.strictYear,
      ],
    );
    const o = r.rows[0]!;
    return {
      paymentId: o.o_payment_id,
      receiptNo: o.o_receipt_no,
      amount: money(input.amount),
      principal: money(o.o_principal),
      lateFee: money(o.o_late_fee),
      advance: money(o.o_advance),
      instalments: o.o_instalments,
      unallocated: money(o.o_advance),
    };
  }

  /**
   * Sprint 9 endpoint kept with its meaning: the amount goes to the principal of the oldest dues (the legacy
   * allocation the Sprint 12 harness models); the late fee stays outstanding on the ledger for the cashier.
   */
  async recordOffline(ctx: RequestContext, dto: RecordOfflinePaymentDto): Promise<ReceiptResult> {
    return this.postReceipt(ctx, { ...dto, ledger: 'school', collectLateFee: false }, false);
  }

  /** Sprint 13: the cashier posts a receipt (validate, number, allocate, late fee, advance in one transaction). */
  async postReceipt(
    ctx: RequestContext,
    dto: PostReceiptDto,
    requireWaivePermission = true,
  ): Promise<ReceiptResult> {
    const { tenant, yearId } = this.yearOf(ctx);
    if (
      requireWaivePermission &&
      !dto.collectLateFee &&
      !ctx.permissions?.has('fees.late_fee.manage')
    )
      throw new DomainError(
        'permission-denied',
        'Leaving the late fee uncollected requires fees.late_fee.manage',
        { status: 403 },
      );
    return this.db.tenant(tenant, async (c) => {
      const s = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        dto.studentId,
      ]);
      if (s.rowCount === 0) throw new DomainError('not-found', 'Student not found');
      // Sprint 23: a closed fee month refuses back-dated receipts
      await assertPeriodOpen(c, dto.ledger, dto.receivedOn ?? null);
      let out: ReceiptResult;
      try {
        out = await this.post(c, {
          studentId: dto.studentId,
          yearId,
          amount: dto.amount,
          receivedOn: dto.receivedOn ?? null,
          mode: dto.mode,
          reference: dto.reference ?? null,
          remarks: dto.remarks ?? null,
          instrumentNo: dto.instrumentNo ?? null,
          instrumentDate: dto.instrumentDate ?? null,
          bankName: dto.bankName ?? null,
          intentId: null,
          ledger: dto.ledger,
          collectLateFee: dto.collectLateFee,
          strictYear: true,
        });
      } catch (error) {
        throw translate(error);
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.receipt.post',
        entityType: 'fee_payments',
        entityId: out.paymentId,
        after: { ...dto, receiptNo: out.receiptNo, lateFee: out.lateFee, advance: out.advance },
      });
      return out;
    });
  }

  /** Online instalment payment started by the accounts desk. */
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
    const { tenant, yearId } = this.yearOf(ctx);
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
        [intent.id, yearId],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.intent.create',
        entityType: 'payment_intents',
        entityId: intent.id,
        after: { studentId: dto.studentId, amount: intent.amount, provider: intent.provider },
      });
      return { intent, form: this.checkout(intent) };
    });
  }

  /** Sprint 13: a guardian pays for one of their children, up to what the ledger says is payable. */
  async createFamilyIntent(ctx: RequestContext, dto: CreateFamilyIntentDto) {
    const { tenant, yearId } = this.yearOf(ctx);
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family' || !v.students.some((s) => s.id === dto.studentId))
      throw new DomainError('permission-denied', 'Not one of your children', { status: 403 });
    const ledger = await this.ledger.ledger(ctx, dto.studentId);
    if (ledger.year.status !== 'active')
      throw new DomainError('year.closed', 'Payments are accepted for the current session only', {
        status: 409,
      });
    const payable = Number(ledger.totals.payable);
    if (dto.amount > payable + 0.005)
      throw new DomainError(
        'payments.amount_exceeds_dues',
        `The amount exceeds the payable balance of ₹${payable.toFixed(2)}`,
        { status: 409, extra: { payable: payable.toFixed(2) } },
      );
    return this.db.tenant(tenant, async (c) => {
      const me = await c.query<{ name: string; email: string | null; mobile: string | null }>(
        `SELECT display_name AS name, email, mobile FROM users WHERE id = app.current_user_id()`,
      );
      const u = me.rows[0]!;
      const intent = await this.createIntent(c, {
        purpose: 'fee_instalment',
        entityType: 'student',
        entityId: dto.studentId,
        amount: dto.amount,
        payer: {
          name: u.name,
          email: u.email ?? 'unknown@example.invalid',
          mobile: u.mobile ?? '',
        },
        returnUrl: `${this.env.PARENT_APP_URL}/fees?student=${dto.studentId}`,
        createdByUser: ctx.user.id,
        requestId: ctx.requestId,
      });
      await c.query(
        `UPDATE payment_intents SET meta = jsonb_build_object('academicYearId', $2::text, 'family', true) WHERE id = $1`,
        [intent.id, yearId],
      );
      await this.audit.stage(ctx, c, {
        action: 'payments.intent.create',
        entityType: 'payment_intents',
        entityId: intent.id,
        after: {
          studentId: dto.studentId,
          amount: intent.amount,
          provider: intent.provider,
          family: true,
        },
      });
      return { intent, checkout: this.checkout(intent) };
    });
  }

  /** Sprint 19: a guardian reopens the checkout of an intent they created (e.g. a consent-form fee). */
  async familyCheckout(
    ctx: RequestContext,
    intentId: string,
  ): Promise<{ intent: IntentRow; checkout: Checkout }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${COLS} FROM payment_intents WHERE id = $1 AND created_by_user = $2 AND status IN ('created', 'pending') AND expires_at > now()`,
        [intentId, ctx.user.id],
      );
      if (!r.rows[0])
        throw new DomainError('not-found', 'Payment not found or no longer payable', {
          status: 404,
        });
      const intent = toRow(r.rows[0]);
      return { intent, checkout: this.checkout(intent) };
    });
  }

  /** The family's own intents (recent first), so the fees page can show what is pending or failed. */
  async familyIntents(ctx: RequestContext): Promise<IntentRow[]> {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family' || v.students.length === 0) return [];
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${COLS} FROM payment_intents WHERE purpose = 'fee_instalment' AND entity_type = 'student' AND entity_id = ANY($1::bigint[])
          ORDER BY created_at DESC LIMIT 20`,
        [v.students.map((s) => s.id)],
      );
      return r.rows.map(toRow);
    });
  }

  /** Success of a fee instalment intent: the receipt posts through app.post_receipt like a counter receipt. */
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
    await this.post(c, {
      studentId: intent.entityId,
      yearId,
      amount: intent.amount,
      receivedOn: null,
      mode: 'online',
      reference: intent.providerRef,
      remarks: null,
      instrumentNo: null,
      instrumentDate: null,
      bankName: null,
      intentId: intent.id,
      ledger: 'school',
      collectLateFee: true,
      strictYear: false,
    });
  }
}

/** PL/pgSQL exceptions of app.post_receipt become domain errors with the same code. */
export function translate(error: unknown): unknown {
  const e = error as { message?: string; detail?: string };
  const known: Record<string, [string, number]> = {
    'fees.no_financial_year': [
      'No financial year covers the receipt date; create it under System → Years',
      409,
    ],
    'fees.amount_invalid': ['The amount must be positive', 400],
    'fees.mode_invalid': ['Unknown payment mode', 400],
    'fees.instrument_required': ['Cheque and DD receipts need the instrument number', 400],
    'fees.student_not_found': ['Student not found', 404],
    'year.closed': ['The session is closed for fees', 409],
    'year.stage_locked': ['Fees are locked for this session', 409],
    'fees.refund_not_approved': ['The refund is not approved', 409],
    'fees.refund_exceeds_receipt': ['The refund exceeds what is left on the receipt', 409],
  };
  const hit = e.message ? known[e.message] : undefined;
  if (!hit) return error;
  let extra: Record<string, unknown> | undefined;
  try {
    extra = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : undefined;
  } catch {
    extra = undefined;
  }
  return new DomainError(e.message!, hit[0], { status: hit[1], extra });
}
