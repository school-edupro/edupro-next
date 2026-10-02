import { decryptField, tenantForJob, type Db, type JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import type { Adapters, Channel, ChannelAdapter, OutboundMessage } from '../adapters';
import { MetaWhatsAppAdapter } from '../adapters/meta-whatsapp.adapter';
import { Msg91Adapter } from '../adapters/msg91.adapter';
import { SmtpAdapter } from '../adapters/smtp.adapter';
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
  format: 'text' | 'html';
  params: string[] | null;
  attachments: Array<{ fileId: string; name: string | null; contentType: string }>;
  dlt_template_id: string | null;
  dlt_entity_id: string | null;
  sender_id: string | null;
  wa_template_name: string | null;
  wa_language: string | null;
  wa_header: 'none' | 'text' | 'image' | 'document' | null;
  wa_params: string[] | null;
  provider: {
    provider: string;
    config: Record<string, unknown>;
    secret: string | null;
    updated_at: string;
  } | null;
}

/** The text part of an HTML email. */
const htmlToText = (html: string): string =>
  html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const cache = new Map<string, { at: number; adapter: ChannelAdapter }>();

/**
 * The school's own provider for the channel (MSG91, Meta WhatsApp, SMTP / SES) when one is saved and
 * active; otherwise the server's adapter from the environment (console in development).
 */
export function schoolAdapter(
  schoolId: string,
  channel: Channel,
  row: MessageDbRow['provider'],
): ChannelAdapter | null {
  if (!row || row.provider === 'console') return null;
  const key = `${schoolId}:${channel}:${row.updated_at}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.adapter;
  const secret = row.secret
    ? (JSON.parse(decryptField(row.secret) ?? '{}') as Record<string, string>)
    : {};
  const cfg = row.config as Record<string, string | number | boolean | undefined>;
  let adapter: ChannelAdapter | null = null;
  if (row.provider === 'msg91' && secret.authKey) adapter = new Msg91Adapter(cfg, secret.authKey);
  if (row.provider === 'meta_whatsapp' && secret.accessToken)
    adapter = new MetaWhatsAppAdapter(cfg, secret.accessToken);
  if (row.provider === 'smtp' && cfg.host) {
    const from = cfg.fromName
      ? `"${String(cfg.fromName)}" <${String(cfg.fromEmail)}>`
      : String(cfg.fromEmail);
    adapter = new SmtpAdapter(
      {
        host: String(cfg.host),
        port: Number(cfg.port ?? 587),
        secure: cfg.secure === true || cfg.secure === 'true',
        ...(cfg.user ? { auth: { user: String(cfg.user), pass: secret.password ?? '' } } : {}),
      },
      from,
      cfg.replyTo ? String(cfg.replyTo) : undefined,
    );
  }
  if (!adapter) throw new Error(`The ${channel} provider (${row.provider}) is missing its keys`);
  cache.set(key, { at: Date.now(), adapter });
  return adapter;
}

/**
 * Delivers one comms_messages row (S3-02, v2). The body was rendered by the API; the worker picks the
 * school's provider, adds attachments (bytes for email, a signed link for a WhatsApp header) and
 * records the outcome. A throw lets BullMQ retry with backoff; the last failed attempt marks the row
 * failed so the delivery log shows it.
 */
export function notificationProcessor(
  db: Db,
  adapters: Adapters,
  log: Logger,
  storage?: StorageDriver,
) {
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
        `SELECT m.id::text, m.channel, m.recipient_address, m.subject, m.body, m.status, m.attempts, m.format, m.params, m.attachments,
                t.dlt_template_id, t.dlt_entity_id, t.sender_id, t.wa_template_name, t.wa_language, t.wa_header, t.wa_params,
                (SELECT jsonb_build_object('provider', p.provider, 'config', p.config, 'secret', p.secret, 'updated_at', p.updated_at)
                   FROM comms_providers p WHERE p.channel = m.channel AND p.active) AS provider
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

    let adapter: ChannelAdapter = adapters[row.channel];
    try {
      adapter =
        schoolAdapter(envelope.schoolId, row.channel, row.provider) ?? adapters[row.channel];
      const attachments: NonNullable<OutboundMessage['attachments']> = [];
      if (row.attachments?.length && storage && row.channel !== 'sms') {
        const files = await db.withTenant(
          tenant,
          async (c) =>
            (
              await c.query<{
                id: string;
                object_key: string;
                content_type: string;
                original_name: string | null;
              }>(
                `SELECT id::text, object_key, content_type, original_name FROM files WHERE id = ANY($1::bigint[]) AND status = 'ready'`,
                [row.attachments.map((a) => a.fileId)],
              )
            ).rows,
        );
        for (const f of files) {
          const name = f.original_name ?? `attachment-${f.id}`;
          if (row.channel === 'email')
            attachments.push({
              name,
              contentType: f.content_type,
              bytes: await storage.read(f.object_key),
            });
          else
            attachments.push({
              name,
              contentType: f.content_type,
              url: (
                await storage.createDownloadUrl(
                  f.object_key,
                  name,
                  f.content_type,
                  f.id,
                  envelope.schoolId,
                )
              ).url,
            });
        }
      }
      const result = await adapter.send({
        id: row.id,
        channel: row.channel,
        to: row.recipient_address,
        subject: row.subject,
        body: row.format === 'html' ? htmlToText(row.body) : row.body,
        html: row.format === 'html' ? row.body : null,
        dlt: {
          templateId: row.dlt_template_id,
          entityId: row.dlt_entity_id,
          senderId: row.sender_id,
        },
        whatsapp:
          row.channel === 'whatsapp'
            ? {
                templateName: row.wa_template_name,
                language: row.wa_language,
                params: row.params ?? [],
                header: row.wa_header ?? 'none',
              }
            : null,
        attachments,
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
