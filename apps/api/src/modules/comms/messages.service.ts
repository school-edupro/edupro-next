import { Injectable, Logger } from '@nestjs/common';
import { QUEUES, type PoolClient, type TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import type { Channel, ListMessagesQueryDto, SendMessageDto } from './comms.dto';
import { PushService, eventOfTemplate } from './push.service';
import { htmlToText, renderTemplate } from './render';
import { TemplatesService, type TemplateRow } from './templates.service';

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled';

export interface MessageRow {
  id: string;
  channel: Channel;
  templateId: string | null;
  templateCode: string | null;
  recipientUserId: string | null;
  recipientName: string | null;
  recipientAddress: string;
  subject: string | null;
  body: string;
  status: MessageStatus;
  provider: string | null;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

interface MessageDbRow {
  id: string;
  channel: Channel;
  template_id: string | null;
  template_code: string | null;
  recipient_user_id: string | null;
  recipient_name: string | null;
  recipient_address: string;
  subject: string | null;
  body: string;
  status: MessageStatus;
  provider: string | null;
  provider_message_id: string | null;
  attempts: number;
  last_error: string | null;
  scheduled_at: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
}

const SELECT = `SELECT m.id::text, m.channel, m.template_id::text, t.code AS template_code, m.recipient_user_id::text, u.display_name AS recipient_name,
         m.recipient_address, m.subject, m.body, m.status, m.provider, m.provider_message_id, m.attempts, m.last_error,
         m.scheduled_at, m.sent_at, m.delivered_at, m.failed_at, m.created_at
    FROM comms_messages m
    LEFT JOIN comms_templates t ON t.id = m.template_id
    LEFT JOIN users u ON u.id = m.recipient_user_id`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const toRow = (x: MessageDbRow): MessageRow => ({
  id: x.id,
  channel: x.channel,
  templateId: x.template_id,
  templateCode: x.template_code,
  recipientUserId: x.recipient_user_id,
  recipientName: x.recipient_name,
  recipientAddress: x.recipient_address,
  subject: x.subject,
  body: x.body,
  status: x.status,
  provider: x.provider,
  providerMessageId: x.provider_message_id,
  attempts: x.attempts,
  lastError: x.last_error,
  scheduledAt: x.scheduled_at.toISOString(),
  sentAt: iso(x.sent_at),
  deliveredAt: iso(x.delivered_at),
  failedAt: iso(x.failed_at),
  createdAt: x.created_at.toISOString(),
});

/**
 * Delivery log producer (S3-02). A message row and its outbox job are written in one transaction; the
 * worker renders nothing (the body is final here) and only talks to the provider.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  constructor(
    private readonly db: DbService,
    private readonly templates: TemplatesService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  list(
    tenant: TenantContext,
    q: ListMessagesQueryDto,
  ): Promise<{ rows: MessageRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE ($1::comms_message_status IS NULL OR m.status = $1::comms_message_status)' +
        ' AND ($2::comms_channel IS NULL OR m.channel = $2::comms_channel)' +
        ' AND ($3::bigint IS NULL OR m.recipient_user_id = $3::bigint)' +
        ' AND ($4::timestamptz IS NULL OR m.created_at >= $4::timestamptz)' +
        ' AND ($5::timestamptz IS NULL OR m.created_at < $5::timestamptz)';
      const params: unknown[] = [
        q.status ?? null,
        q.channel ?? null,
        q.recipientUserId ?? null,
        q.from ?? null,
        q.to ?? null,
      ];
      const total = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM comms_messages m' + where,
        params,
      );
      const r = await c.query<MessageDbRow>(
        SELECT + where + ' ORDER BY m.created_at DESC LIMIT $6 OFFSET $7',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async get(tenant: TenantContext, id: string, client?: PoolClient): Promise<MessageRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<MessageDbRow>(SELECT + ' WHERE m.id = $1', [id]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Message not found');
      return toRow(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async send(ctx: RequestContext, dto: SendMessageDto): Promise<MessageRow> {
    return this.db.tenant(requireTenant(ctx), (c) => this.sendWith(c, ctx, dto));
  }

  /**
   * Alerts (templates flagged `is_alert`) are throttled per recipient address: at most
   * `comms.alert_throttle_per_hour` (default 6) in a rolling hour. Returns null when throttled so callers
   * record the skip instead of failing the business transaction (S11).
   */
  async sendAlert(
    c: PoolClient,
    ctx: RequestContext,
    dto: SendMessageDto,
  ): Promise<MessageRow | null> {
    const address = dto.recipientAddress;
    if (address) {
      const r = await c.query<{ n: number; limit: number | null }>(
        `SELECT (SELECT count(*)::int FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id WHERE t.is_alert AND m.recipient_address = $1 AND m.created_at > now() - interval '1 hour') AS n,
                (app.setting('comms.alert_throttle_per_hour'))::text::int AS limit`,
        [address],
      );
      const limit = r.rows[0]?.limit ?? 6;
      if ((r.rows[0]?.n ?? 0) >= limit) {
        this.logger.warn({ address: address.slice(-4), limit }, 'alert throttled');
        return null;
      }
    }
    return this.sendWith(c, ctx, dto);
  }

  /** The same as `send`, inside a caller's transaction (bulk dispatch of an approved request, S10). */
  async sendWith(c: PoolClient, ctx: RequestContext, dto: SendMessageDto): Promise<MessageRow> {
    const tenant = requireTenant(ctx);
    {
      const template = await this.resolveTemplate(tenant, dto, c);
      const channel = template.channel;
      const { userId, address, name } = await this.resolveRecipient(c, dto, channel);

      const body = renderTemplate(template.body, dto.variables);
      const subject = template.subject ? renderTemplate(template.subject, dto.variables) : null;
      const missing = [...new Set([...body.missing, ...(subject?.missing ?? [])])];
      if (missing.length > 0) {
        throw new DomainError('validation-failed', 'Missing template variables', {
          status: 400,
          extra: { missing },
        });
      }

      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, template_id, channel, recipient_user_id, recipient_address, subject, body, variables, scheduled_at, request_id, created_by)
         VALUES (app.current_school_id(), $1, $2::comms_channel, $3, $4, $5, $6, $7::jsonb, COALESCE($8::timestamptz, now()), app.current_request_id(), app.current_user_id())
         RETURNING id::text`,
        [
          template.id,
          channel,
          userId,
          address,
          subject?.text ?? null,
          body.text,
          JSON.stringify(dto.variables),
          dto.scheduledAt ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      await this.outbox.enqueue(
        c,
        ctx,
        QUEUES.notifications,
        'comms.message',
        { messageId: id },
        dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      );
      const row = await this.get(tenant, id, c);
      // automatic alerts (attendance, fees, transport, queries...) also reach the person's app
      if (channel !== 'push') {
        const users = userId ? [userId] : await this.push.usersOfAddresses(c, [address]);
        await this.push.send(c, ctx, {
          userIds: users,
          title: template.name,
          body: (template.format === 'html' ? htmlToText(body.text) : body.text).slice(0, 300),
          link: '/messages',
          event: eventOfTemplate(template.code),
          dedupe: true,
        });
      }
      await this.audit.stage(ctx, c, {
        action: 'comms.message.send',
        entityType: 'comms_messages',
        entityId: id,
        after: {
          id,
          channel,
          templateCode: template.code,
          recipientUserId: userId,
          recipientName: name,
          status: row.status,
        },
      });
      return row;
    }
  }

  async cancel(ctx: RequestContext, id: string): Promise<MessageRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      if (before.status !== 'queued')
        throw new DomainError('comms.message.not_queued', 'Only queued messages can be cancelled', {
          status: 409,
        });
      await c.query(
        "UPDATE comms_messages SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'queued'",
        [id],
      );
      const after = await this.get(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'comms.message.cancel',
        entityType: 'comms_messages',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status },
      });
      return after;
    });
  }

  private async resolveTemplate(
    tenant: TenantContext,
    dto: SendMessageDto,
    c: PoolClient,
  ): Promise<TemplateRow> {
    if (dto.templateId) {
      const t = await this.templates.get(tenant, dto.templateId, c);
      if (t.status !== 'active')
        throw new DomainError('comms.template.inactive', 'The template is inactive', {
          status: 409,
        });
      return t;
    }
    const r = await c.query<{ id: string }>(
      "SELECT id::text FROM comms_templates WHERE code = $1 AND channel = $2::comms_channel AND status = 'active' AND deleted_at IS NULL",
      [dto.templateCode, dto.channel],
    );
    if (!r.rows[0])
      throw new DomainError(
        'comms.template.not_found',
        'No active template with that code and channel',
      );
    return this.templates.get(tenant, r.rows[0].id, c);
  }

  private async resolveRecipient(
    c: PoolClient,
    dto: SendMessageDto,
    channel: Channel,
  ): Promise<{ userId: string | null; address: string; name: string | null }> {
    if (!dto.recipientUserId) return { userId: null, address: dto.recipientAddress!, name: null };
    const r = await c.query<{
      id: string;
      display_name: string;
      mobile: string | null;
      email: string | null;
    }>(
      `SELECT u.id::text, u.display_name, u.mobile, u.email
         FROM users u
         JOIN user_school_memberships m ON m.user_id = u.id AND m.school_id = app.current_school_id() AND m.deleted_at IS NULL
        WHERE u.id = $1 AND u.deleted_at IS NULL
        LIMIT 1`,
      [dto.recipientUserId],
    );
    const u = r.rows[0];
    if (!u)
      throw new DomainError('user.not_member', 'The recipient is not a member of this school', {
        status: 409,
      });
    const address = dto.recipientAddress ?? (channel === 'email' ? u.email : u.mobile);
    if (!address) {
      throw new DomainError(
        'comms.recipient.address_missing',
        `The recipient has no ${channel === 'email' ? 'email address' : 'mobile number'} on file`,
        {
          status: 422,
        },
      );
    }
    return { userId: u.id, address, name: u.display_name };
  }
}
