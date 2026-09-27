import { tenantForJob, type Db, type JobEnvelope } from '@edupro/db';
import type { Adapters, Channel } from '../adapters';
import type { Logger } from '../logger';

/** The subset of a BullMQ job the processor needs; tests pass plain objects. */
export interface JobLike<T> {
  id?: string;
  data: JobEnvelope<T>;
  attemptsMade: number;
  opts: { attempts?: number };
}

interface MessageDbRow {
  id: string;
  channel: Channel;
  recipient_address: string;
  subject: string | null;
  body: string;
  status: string;
  attempts: number;
  dlt_template_id: string | null;
  dlt_entity_id: string | null;
  sender_id: string | null;
}

/**
 * Delivers one comms_messages row (S3-02). The body was rendered by the API; the worker only talks to the
 * provider and records the outcome. A throw lets BullMQ retry with backoff; the last failed attempt marks
 * the row failed so the delivery log shows it.
 */
export function notificationProcessor(db: Db, adapters: Adapters, log: Logger) {
  return async (job: JobLike<{ messageId: string }>): Promise<void> => {
    const envelope = job.data;
    if (envelope.kind !== 'comms.message') {
      log.warn({ kind: envelope.kind }, 'unknown notification job kind');
      return;
    }
    const tenant = tenantForJob(envelope);
    const messageId = envelope.payload.messageId;

    const row = await db.withTenant(tenant, async (c) => {
      const r = await c.query<MessageDbRow>(
        `SELECT m.id::text, m.channel, m.recipient_address, m.subject, m.body, m.status, m.attempts,
                t.dlt_template_id, t.dlt_entity_id, t.sender_id
           FROM comms_messages m LEFT JOIN comms_templates t ON t.id = m.template_id
          WHERE m.id = $1`,
        [messageId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) {
      log.warn({ messageId, schoolId: envelope.schoolId }, 'message not found; nothing to send');
      return;
    }
    if (row.status === 'cancelled' || row.status === 'sent' || row.status === 'delivered') {
      log.info({ messageId, status: row.status }, 'message already final; skipping');
      return;
    }

    await db.withTenant(tenant, (c) =>
      c.query("UPDATE comms_messages SET status = 'sending', updated_at = now() WHERE id = $1", [
        messageId,
      ]),
    );

    const adapter = adapters[row.channel];
    try {
      const result = await adapter.send({
        id: row.id,
        channel: row.channel,
        to: row.recipient_address,
        subject: row.subject,
        body: row.body,
        dlt: {
          templateId: row.dlt_template_id,
          entityId: row.dlt_entity_id,
          senderId: row.sender_id,
        },
      });
      await db.withTenant(tenant, (c) =>
        c.query(
          `UPDATE comms_messages
              SET status = $2::comms_message_status, provider = $3, provider_message_id = $4, attempts = attempts + 1,
                  sent_at = now(), delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
                  last_error = NULL, updated_at = now()
            WHERE id = $1`,
          [
            messageId,
            result.delivered ? 'delivered' : 'sent',
            adapter.name,
            result.providerMessageId,
          ],
        ),
      );
      log.info({ messageId, channel: row.channel, provider: adapter.name }, 'notification sent');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await db.withTenant(tenant, (c) =>
        c.query(
          `UPDATE comms_messages
              SET attempts = attempts + 1, last_error = left($2, 1000), provider = $3,
                  status = CASE WHEN $4 THEN 'failed'::comms_message_status ELSE 'queued'::comms_message_status END,
                  failed_at = CASE WHEN $4 THEN now() ELSE failed_at END, updated_at = now()
            WHERE id = $1`,
          [messageId, message, adapter.name, lastAttempt],
        ),
      );
      log.error(
        { messageId, channel: row.channel, provider: adapter.name, err: message, lastAttempt },
        'notification failed',
      );
      throw error;
    }
  };
}
