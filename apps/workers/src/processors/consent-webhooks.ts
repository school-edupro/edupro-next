import { createHmac } from 'node:crypto';
import { decryptField } from '@edupro/db';

/** Minutes to wait before the next attempt of a failed delivery (five attempts in all). */
const BACKOFF = [1, 5, 30, 120];
const PRIVATE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\]|0\.0\.0\.0)/;

interface Client {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Delivers the due consent form webhook messages of one school (docs/design/28-consent-forms.md part 4):
 * a POST of the JSON with `X-EduPro-Event`, `X-EduPro-Delivery`, `X-EduPro-Timestamp` and
 * `X-EduPro-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<body>" with the webhook's secret>`. A 2xx
 * answer within ten seconds delivers it; otherwise it is tried again after 1, 5, 30 and 120 minutes, then
 * marked failed (the school can send it again). In production only https addresses on the internet.
 */
export async function deliverConsentWebhooks(
  c: Client,
  opts: { production: boolean; fetchFn?: typeof fetch; limit?: number },
): Promise<{ delivered: number; retried: number; failed: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const due = await c.query<{
    id: string;
    event: string;
    payload: unknown;
    attempts: number;
    url: string;
    secret: string;
  }>(
    `SELECT d.id::text, d.event, d.payload, d.attempts, w.url, w.secret
       FROM consent_webhook_deliveries d JOIN consent_webhooks w ON w.id = d.webhook_id
      WHERE d.status = 'pending' AND d.next_at <= now() AND w.deleted_at IS NULL
      ORDER BY d.next_at LIMIT $1 FOR UPDATE OF d SKIP LOCKED`,
    [opts.limit ?? 20],
  );
  const out = { delivered: 0, retried: 0, failed: 0 };
  for (const d of due.rows) {
    let status: number | null = null;
    let error: string | null = null;
    try {
      const u = new URL(d.url);
      if (opts.production && (u.protocol !== 'https:' || PRIVATE.test(u.hostname)))
        throw new Error('only https addresses on the internet');
      const secret = decryptField(d.secret);
      if (!secret) throw new Error('the signing secret cannot be read');
      const body = JSON.stringify(d.payload);
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
      const res = await fetchFn(d.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'EduPro-Webhooks/1',
          'x-edupro-event': d.event,
          'x-edupro-delivery': d.id,
          'x-edupro-timestamp': ts,
          'x-edupro-signature': `sha256=${sig}`,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    if (!error) {
      await c.query(
        `UPDATE consent_webhook_deliveries SET status = 'delivered', attempts = attempts + 1, last_status = $2, last_error = NULL, delivered_at = now() WHERE id = $1`,
        [d.id, status],
      );
      out.delivered += 1;
      continue;
    }
    const attempts = d.attempts + 1;
    const wait = BACKOFF[attempts - 1];
    await c.query(
      `UPDATE consent_webhook_deliveries SET attempts = $2, last_status = $3, last_error = $4,
              status = CASE WHEN $5::int IS NULL THEN 'failed' ELSE 'pending' END,
              next_at = CASE WHEN $5::int IS NULL THEN next_at ELSE now() + make_interval(mins => $5::int) END
        WHERE id = $1`,
      [d.id, attempts, status, error, wait ?? null],
    );
    if (wait === undefined) out.failed += 1;
    else out.retried += 1;
  }
  return out;
}
