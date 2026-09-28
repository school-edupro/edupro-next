import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay (Sprint 13). Orders are created server to server (basic auth with key id and secret), the browser
 * completes checkout with the public key id and the order id, and two signatures come back:
 *   checkout handler / return: HMAC-SHA256(order_id + "|" + payment_id, key_secret) = razorpay_signature
 *   webhook:                   HMAC-SHA256(raw request body, webhook_secret)       = X-Razorpay-Signature
 * Both checks are mandatory and constant-time, like the PayU response hash (threat model P1).
 */
export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl: string;
}

export interface RazorpayOrder {
  id: string;
  amount: number; // paise
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayCheckout {
  kind: 'razorpay';
  keyId: string;
  orderId: string;
  /** Paise, as Razorpay expects. */
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  notes: { txnId: string; intentId: string };
  /** Where the checkout handler posts order id, payment id and signature. */
  callbackUrl: string;
  /** Where the browser lands afterwards. */
  returnUrl: string | null;
}

export interface RazorpayCallback {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export const toPaise = (amount: string | number): number => Math.round(Number(amount) * 100);
export const fromPaise = (paise: number): string => (paise / 100).toFixed(2);

const hmac = (secret: string, data: string) =>
  createHmac('sha256', secret).update(data).digest('hex');

const safeEqual = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(given ?? ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

export function checkoutSignature(orderId: string, paymentId: string, keySecret: string): string {
  return hmac(keySecret, `${orderId}|${paymentId}`);
}

export function verifyCheckout(cb: RazorpayCallback, keySecret: string): boolean {
  if (!cb.razorpay_order_id || !cb.razorpay_payment_id) return false;
  return safeEqual(
    checkoutSignature(cb.razorpay_order_id, cb.razorpay_payment_id, keySecret),
    cb.razorpay_signature,
  );
}

export function webhookSignature(rawBody: string | Buffer, webhookSecret: string): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

export function verifyWebhook(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string,
): boolean {
  if (!signature) return false;
  return safeEqual(webhookSignature(rawBody, webhookSecret), signature);
}

/** The webhook payload shape this integration reads (payment.captured, payment.failed, refund.processed). */
export interface RazorpayWebhookEvent {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id: string;
        order_id?: string;
        amount: number;
        status: string;
        error_description?: string | null;
        notes?: Record<string, string>;
      };
    };
    refund?: {
      entity?: {
        id: string;
        payment_id: string;
        amount: number;
        status: string;
        notes?: Record<string, string>;
      };
    };
  };
}

/** Normalised view of a webhook event for the payments service. */
export function readWebhook(ev: RazorpayWebhookEvent): {
  kind: 'payment' | 'refund' | 'other';
  orderId: string | null;
  paymentId: string | null;
  refundId: string | null;
  amount: string | null;
  status: 'success' | 'failure' | 'pending';
  reason: string | null;
} {
  const p = ev.payload?.payment?.entity;
  const r = ev.payload?.refund?.entity;
  if (ev.event.startsWith('refund.') && r)
    return {
      kind: 'refund',
      orderId: null,
      paymentId: r.payment_id,
      refundId: r.id,
      amount: fromPaise(r.amount),
      status: r.status === 'processed' ? 'success' : r.status === 'failed' ? 'failure' : 'pending',
      reason: null,
    };
  if (ev.event.startsWith('payment.') && p)
    return {
      kind: 'payment',
      orderId: p.order_id ?? null,
      paymentId: p.id,
      refundId: null,
      amount: fromPaise(p.amount),
      status:
        ev.event === 'payment.captured' || p.status === 'captured'
          ? 'success'
          : ev.event === 'payment.failed' || p.status === 'failed'
            ? 'failure'
            : 'pending',
      reason: p.error_description ?? null,
    };
  return {
    kind: 'other',
    orderId: null,
    paymentId: null,
    refundId: null,
    amount: null,
    status: 'pending',
    reason: null,
  };
}

const authHeader = (c: RazorpayCredentials) =>
  `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`, 'utf8').toString('base64')}`;

/** Creates the order the browser checkout needs. Network only; the mock provider never calls this. */
export async function createOrder(
  c: RazorpayCredentials,
  input: { amount: string | number; receipt: string; notes: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<RazorpayOrder> {
  const res = await fetchImpl(`${c.baseUrl}/v1/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: toPaise(input.amount),
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
    }),
  });
  if (!res.ok) throw new Error(`razorpay order failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as RazorpayOrder;
}

/** Refunds a captured payment (full or partial). */
export async function createRefund(
  c: RazorpayCredentials,
  input: { paymentId: string; amount: string | number; notes: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; status: string; amount: number }> {
  const res = await fetchImpl(`${c.baseUrl}/v1/payments/${input.paymentId}/refund`, {
    method: 'POST',
    headers: { Authorization: authHeader(c), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: toPaise(input.amount), notes: input.notes, speed: 'normal' }),
  });
  if (!res.ok) throw new Error(`razorpay refund failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string; amount: number };
}
