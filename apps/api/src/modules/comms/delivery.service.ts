import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { decryptField } from '@edupro/db';
import { ENV, type Env } from '../../config/env';
import { DbService } from '../../common/db/db.service';
import { publicTenant } from '../admissions/public/otp.service';
import { DomainError } from '../../common/errors/domain-error';
import type { DeliveryReceiptDto } from './comms.dto';

type Outcome = 'applied' | 'duplicate' | 'unknown_message';

const same = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Provider delivery receipts (S10, v2). The generic receipt trusts the shared token; MSG91 delivery
 * reports carry the same token in the URL; Meta WhatsApp statuses are signed with the school's app
 * secret (found from the phone number id). Each event is applied once; a WhatsApp "read" sets read_at.
 */
@Injectable()
export class DeliveryService {
  private readonly log = new Logger(DeliveryService.name);
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  private checkToken(token: string | undefined) {
    if (!same(token ?? '', this.env.COMMS_WEBHOOK_TOKEN))
      throw new DomainError('webhook-unauthenticated', 'Wrong or missing webhook token', {
        status: 401,
      });
  }

  async receipt(dto: DeliveryReceiptDto, token: string | undefined) {
    this.checkToken(token);
    const r = await this.apply(
      dto.provider,
      dto.messageId,
      dto.receiptId ?? dto.messageId,
      dto.status,
      false,
      dto.reason ?? null,
      dto,
    );
    return { outcome: r.outcome, messageId: r.messageId };
  }

  /** One provider event, applied once (keyed by provider, event id, status and read). */
  private async apply(
    provider: string,
    providerRef: string,
    eventId: string,
    status: 'delivered' | 'failed' | 'sent',
    isRead: boolean,
    reason: string | null,
    payload: unknown,
  ): Promise<{ outcome: Outcome; messageId: string | null }> {
    const lookup = await this.db.global(async (c) => {
      const r = await c.query<{ school_id: string; message_id: string }>(
        `SELECT school_id::text, message_id::text FROM app.message_lookup_by_provider_ref($1, $2)`,
        [provider, providerRef],
      );
      return r.rows[0] ?? null;
    });
    if (!lookup) return { outcome: 'unknown_message', messageId: null };
    return this.db.tenant(publicTenant(lookup.school_id), async (c) => {
      const inserted = await c.query(
        `INSERT INTO comms_delivery_events (school_id, message_id, provider, external_id, status, is_read, reason, payload)
         VALUES (app.current_school_id(), $1, $2, $3, $4::comms_message_status, $5, $6, $7::jsonb)
         ON CONFLICT (provider, external_id, status, is_read) DO NOTHING`,
        [lookup.message_id, provider, eventId, status, isRead, reason, JSON.stringify(payload)],
      );
      if (!inserted.rowCount)
        return { outcome: 'duplicate' as const, messageId: lookup.message_id };
      if (isRead)
        await c.query(
          `UPDATE comms_messages SET read_at = COALESCE(read_at, now()), status = CASE WHEN status IN ('sent', 'sending', 'queued') THEN 'delivered' ELSE status END,
                  delivered_at = COALESCE(delivered_at, now()), updated_at = now() WHERE id = $1`,
          [lookup.message_id],
        );
      else if (status === 'delivered')
        await c.query(
          `UPDATE comms_messages SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now() WHERE id = $1 AND status IN ('sent', 'sending', 'queued')`,
          [lookup.message_id],
        );
      else if (status === 'failed')
        await c.query(
          `UPDATE comms_messages SET status = 'failed', failed_at = now(), last_error = left($2, 1000), updated_at = now() WHERE id = $1 AND status <> 'delivered'`,
          [lookup.message_id, reason ?? 'provider reported failure'],
        );
      return { outcome: 'applied' as const, messageId: lookup.message_id };
    });
  }

  /**
   * MSG91 delivery report (JSON): [{ requestId, report: [{ desc|status, number, date }] }], or the
   * same under `data` (possibly as a JSON string).
   */
  async msg91(body: unknown, token: string | undefined) {
    this.checkToken(token);
    let items: unknown = body;
    if (items && typeof items === 'object' && 'data' in items)
      items = (items as { data: unknown }).data;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    const list = Array.isArray(items) ? items : [items];
    let applied = 0;
    for (const raw of list as Array<{
      requestId?: string;
      report?: Array<Record<string, string>>;
    }>) {
      if (!raw?.requestId) continue;
      for (const rep of raw.report ?? []) {
        const desc = String(rep.desc ?? rep.status ?? '').toUpperCase();
        const status =
          desc === 'DELIVERED' || desc === '1'
            ? 'delivered'
            : /FAIL|REJECT|NDNC|BLOCK|EXPIRE/.test(desc) ||
                ['2', '9', '16', '17', '25', '26'].includes(desc)
              ? 'failed'
              : null;
        if (!status) continue;
        const r = await this.apply(
          'msg91',
          raw.requestId,
          `${raw.requestId}:${rep.number ?? ''}`,
          status,
          false,
          status === 'failed' ? desc : null,
          rep,
        );
        if (r.outcome === 'applied') applied += 1;
      }
    }
    return { applied };
  }

  /** Meta's subscription check: echo the challenge when the verify token is one a school saved. */
  async metaVerify(q: Record<string, string | undefined>): Promise<string> {
    if (q['hub.mode'] !== 'subscribe' || !q['hub.verify_token'] || !q['hub.challenge'])
      throw new DomainError('webhook-unauthenticated', 'Not a subscription check', { status: 403 });
    const ok = await this.db.global(async (c) => {
      const r = await c.query<{ ok: boolean }>(`SELECT app.comms_meta_verify_token($1) AS ok`, [
        q['hub.verify_token'],
      ]);
      return r.rows[0]?.ok ?? false;
    });
    if (!ok)
      throw new DomainError('webhook-unauthenticated', 'Unknown verify token', { status: 403 });
    return q['hub.challenge'];
  }

  /** Meta statuses (sent, delivered, read, failed), signed with the school's app secret. */
  async meta(raw: Buffer | string, signature: string | undefined, body: unknown) {
    const entries = ((body as { entry?: unknown[] })?.entry ?? []) as Array<{
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          statuses?: Array<{
            id: string;
            status: string;
            errors?: Array<{ title?: string; message?: string }>;
          }>;
        };
      }>;
    }>;
    let applied = 0;
    for (const e of entries)
      for (const ch of e.changes ?? []) {
        const v = ch.value;
        const phoneId = v?.metadata?.phone_number_id;
        if (!phoneId || !v?.statuses?.length) continue;
        const provider = await this.db.global(async (c) => {
          const r = await c.query<{ school_id: string; secret: string | null }>(
            `SELECT school_id::text, secret FROM app.comms_meta_provider($1)`,
            [phoneId],
          );
          return r.rows[0] ?? null;
        });
        if (!provider) continue;
        const secrets = provider.secret
          ? (JSON.parse(decryptField(provider.secret) ?? '{}') as Record<string, string>)
          : {};
        if (!secrets.appSecret) {
          this.log.warn(
            { schoolId: provider.school_id },
            'WhatsApp webhook ignored: app secret not saved',
          );
          continue;
        }
        const expected = `sha256=${createHmac('sha256', secrets.appSecret).update(raw).digest('hex')}`;
        if (!same(signature ?? '', expected))
          throw new DomainError('webhook-unauthenticated', 'Bad signature', { status: 401 });
        for (const s of v.statuses) {
          const map: Record<string, ['sent' | 'delivered' | 'failed', boolean] | undefined> = {
            sent: ['sent', false],
            delivered: ['delivered', false],
            read: ['delivered', true],
            failed: ['failed', false],
          };
          const m = map[s.status];
          if (!m) continue;
          const reason =
            s.errors
              ?.map((x) => x.message ?? x.title)
              .filter(Boolean)
              .join('; ') || null;
          const r = await this.apply('meta_whatsapp', s.id, s.id, m[0], m[1], reason, s);
          if (r.outcome === 'applied') applied += 1;
        }
      }
    return { applied };
  }
}
