import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService } from '../../common/db/db.service';
import { publicTenant } from '../admissions/public/otp.service';
import { DomainError } from '../../common/errors/domain-error';
import type { DeliveryReceiptDto } from './comms.dto';

/**
 * Provider delivery receipts (S10 delivery tracking). Providers call back with their message id and the final
 * state; the endpoint is unauthenticated network-wise and trusts a shared token, matches the message through a
 * SECURITY DEFINER lookup, and applies each receipt once.
 */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
  ) {}

  async receipt(dto: DeliveryReceiptDto, token: string | undefined) {
    const given = Buffer.from(token ?? '', 'utf8');
    const expected = Buffer.from(this.env.COMMS_WEBHOOK_TOKEN, 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new DomainError('webhook-unauthenticated', 'Wrong or missing webhook token', {
        status: 401,
      });
    const lookup = await this.db.global(async (c) => {
      const r = await c.query<{ school_id: string; message_id: string }>(
        `SELECT school_id::text, message_id::text FROM app.message_lookup_by_provider_ref($1, $2)`,
        [dto.provider, dto.messageId],
      );
      return r.rows[0] ?? null;
    });
    if (!lookup) return { outcome: 'unknown_message' as const, messageId: null };
    return this.db.tenant(publicTenant(lookup.school_id), async (c) => {
      const inserted = await c.query(
        `INSERT INTO comms_delivery_events (school_id, message_id, provider, external_id, status, reason, payload) VALUES (app.current_school_id(), $1, $2, $3, $4::comms_message_status, $5, $6::jsonb)
         ON CONFLICT (provider, external_id, status) DO NOTHING`,
        [
          lookup.message_id,
          dto.provider,
          dto.receiptId ?? dto.messageId,
          dto.status,
          dto.reason ?? null,
          JSON.stringify(dto),
        ],
      );
      if (!inserted.rowCount)
        return { outcome: 'duplicate' as const, messageId: lookup.message_id };
      if (dto.status === 'delivered')
        await c.query(
          `UPDATE comms_messages SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now() WHERE id = $1 AND status IN ('sent', 'sending', 'queued')`,
          [lookup.message_id],
        );
      else
        await c.query(
          `UPDATE comms_messages SET status = 'failed', failed_at = now(), last_error = left($2, 1000), updated_at = now() WHERE id = $1 AND status <> 'delivered'`,
          [lookup.message_id, dto.reason ?? 'provider reported failure'],
        );
      return { outcome: 'applied' as const, messageId: lookup.message_id };
    });
  }
}
