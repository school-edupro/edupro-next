import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { QUEUES, decryptField, encryptField, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { normaliseEmail, normaliseMobile } from './audience';
import type { CommsSettingsDto, CreditDto, ProviderDto, ProviderTestDto } from './comms.dto';

export type ProviderChannel = 'sms' | 'whatsapp' | 'email';

export interface CommsPolicy {
  approvalThreshold: number;
  approvalExemptRoles: string[];
  quietFrom: string | null;
  quietTo: string | null;
  attachmentMaxMb: number;
  rates: Record<ProviderChannel, number>;
  lowBalance: Partial<Record<ProviderChannel, number>>;
}

/** Secret fields of each provider: stored encrypted, shown only as "saved". */
const SECRET_FIELDS: Record<string, string[]> = {
  msg91: ['authKey'],
  meta_whatsapp: ['accessToken', 'appSecret'],
  smtp: ['password'],
  console: [],
};
const PROVIDER_FOR: Record<ProviderChannel, string[]> = {
  sms: ['msg91', 'console'],
  whatsapp: ['meta_whatsapp', 'console'],
  email: ['smtp', 'console'],
};

/**
 * Communication settings (v2): the school's own providers (MSG91 for DLT SMS, Meta WhatsApp Cloud API,
 * SMTP or Amazon SES SMTP for email) with keys encrypted at rest and never returned; the approval rule,
 * quiet hours, attachment size, rates; and the credit ledger behind the monthly usage statement.
 */
@Injectable()
export class CommsSettingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The policy for this school (defaults until saved). */
  async policy(c: PoolClient): Promise<CommsPolicy> {
    const r = await c.query<{
      approval_threshold: number;
      approval_exempt_roles: string[];
      quiet_from: string | null;
      quiet_to: string | null;
      attachment_max_mb: number;
      rates: Record<ProviderChannel, number>;
      low_balance: Partial<Record<ProviderChannel, number>>;
    }>(
      `SELECT approval_threshold, approval_exempt_roles, to_char(quiet_from, 'HH24:MI') AS quiet_from, to_char(quiet_to, 'HH24:MI') AS quiet_to,
              attachment_max_mb, rates, low_balance FROM comms_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0];
    return {
      approvalThreshold: x?.approval_threshold ?? 100,
      approvalExemptRoles: x?.approval_exempt_roles ?? ['group_admin', 'school_admin', 'principal'],
      quietFrom: x?.quiet_from ?? null,
      quietTo: x?.quiet_to ?? null,
      attachmentMaxMb: x?.attachment_max_mb ?? 5,
      rates: x?.rates ?? { sms: 0.2, whatsapp: 0.8, email: 0 },
      lowBalance: x?.low_balance ?? { sms: 1000, whatsapp: 200 },
    };
  }

  async get(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const providers = await c.query<{
        channel: ProviderChannel;
        provider: string;
        config: Record<string, unknown>;
        secret: string | null;
        active: boolean;
        updated_at: Date;
      }>(
        `SELECT channel::text, provider, config, secret, active, updated_at FROM comms_providers ORDER BY channel`,
      );
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND deleted_at IS NULL AND code NOT IN ('parent', 'student', 'support_engineer') ORDER BY name`,
      );
      return {
        policy: await this.policy(c),
        providers: providers.rows.map((p) => {
          const saved = p.secret
            ? (JSON.parse(decryptField(p.secret) ?? '{}') as Record<string, string>)
            : {};
          return {
            channel: p.channel,
            provider: p.provider,
            config: p.config,
            secrets: Object.fromEntries(
              (SECRET_FIELDS[p.provider] ?? []).map((k) => [k, Boolean(saved[k])]),
            ),
            active: p.active,
            updatedAt: p.updated_at.toISOString(),
          };
        }),
        roles: roles.rows,
        webhooks: {
          msg91: '/api/v1/comms/webhooks/msg91',
          meta: '/api/v1/comms/webhooks/meta',
        },
      };
    });
  }

  async savePolicy(ctx: RequestContext, dto: CommsSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.policy(c);
      await c.query(
        `INSERT INTO comms_settings (school_id, approval_threshold, approval_exempt_roles, quiet_from, quiet_to, attachment_max_mb, rates, low_balance, updated_by)
         VALUES (app.current_school_id(), $1, $2::text[], $3::time, $4::time, $5, $6::jsonb, $7::jsonb, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET approval_threshold = EXCLUDED.approval_threshold, approval_exempt_roles = EXCLUDED.approval_exempt_roles,
           quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to, attachment_max_mb = EXCLUDED.attachment_max_mb,
           rates = EXCLUDED.rates, low_balance = EXCLUDED.low_balance, updated_at = now(), updated_by = app.current_user_id()`,
        [
          dto.approvalThreshold,
          dto.approvalExemptRoles,
          dto.quietFrom || null,
          dto.quietTo || null,
          dto.attachmentMaxMb,
          JSON.stringify(dto.rates),
          JSON.stringify(dto.lowBalance),
        ],
      );
      const after = await this.policy(c);
      await this.audit.stage(ctx, c, {
        action: 'comms.settings.edit',
        entityType: 'comms_settings',
        before,
        after,
      });
      return after;
    });
  }

  /** Saves a provider. Secret fields left empty keep the saved value. */
  async saveProvider(ctx: RequestContext, channel: ProviderChannel, dto: ProviderDto) {
    if (!PROVIDER_FOR[channel].includes(dto.provider))
      throw new DomainError('validation-failed', `${dto.provider} does not send ${channel}`, {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const existing = await c.query<{
        provider: string;
        secret: string | null;
        config: Record<string, unknown>;
      }>(`SELECT provider, secret, config FROM comms_providers WHERE channel = $1::comms_channel`, [
        channel,
      ]);
      const old =
        existing.rows[0]?.provider === dto.provider && existing.rows[0].secret
          ? (JSON.parse(decryptField(existing.rows[0].secret) ?? '{}') as Record<string, string>)
          : {};
      const secrets: Record<string, string> = { ...old };
      for (const k of SECRET_FIELDS[dto.provider] ?? []) {
        const v = dto.secrets?.[k];
        if (v) secrets[k] = v;
      }
      const config: Record<string, unknown> = { ...dto.config };
      // the token Meta echoes back when the school registers the webhook
      if (dto.provider === 'meta_whatsapp')
        config.verifyToken =
          (existing.rows[0]?.config?.verifyToken as string | undefined) ??
          randomBytes(16).toString('hex');
      await c.query(
        `INSERT INTO comms_providers (school_id, channel, provider, config, secret, active, updated_by)
         VALUES (app.current_school_id(), $1::comms_channel, $2, $3::jsonb, $4, $5, app.current_user_id())
         ON CONFLICT (school_id, channel) DO UPDATE SET provider = EXCLUDED.provider, config = EXCLUDED.config, secret = EXCLUDED.secret,
           active = EXCLUDED.active, updated_at = now(), updated_by = app.current_user_id()`,
        [
          channel,
          dto.provider,
          JSON.stringify(config),
          Object.keys(secrets).length ? encryptField(JSON.stringify(secrets)) : null,
          dto.active,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.provider.edit',
        entityType: 'comms_providers',
        entityId: channel,
        // keys never go to the audit log
        after: {
          provider: dto.provider,
          config,
          secrets: Object.keys(secrets),
          active: dto.active,
        },
      });
      return { ok: true as const };
    });
  }

  /** Queues a test message through the saved provider; the delivery log shows the outcome. */
  async test(ctx: RequestContext, channel: ProviderChannel, dto: ProviderTestDto) {
    const address = channel === 'email' ? normaliseEmail(dto.to) : normaliseMobile(dto.to);
    if (!address)
      throw new DomainError(
        'validation-failed',
        channel === 'email' ? 'Enter a valid email' : 'Enter a valid 10-digit mobile',
        { status: 400 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]?.name;
      const body =
        dto.text?.trim() || `Test message from ${school ?? 'EduPro'}: your ${channel} setup works.`;
      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_messages (school_id, template_id, channel, recipient_address, subject, body, variables, request_id, created_by)
         VALUES (app.current_school_id(), $1, $2::comms_channel, $3, $4, $5, '{}'::jsonb, app.current_request_id(), app.current_user_id()) RETURNING id::text`,
        [
          dto.templateId ?? null,
          channel,
          address,
          channel === 'email' ? `Test email from ${school ?? 'EduPro'}` : null,
          body,
        ],
      );
      await this.outbox.enqueue(c, ctx, QUEUES.notifications, 'comms.message', {
        messageId: r.rows[0]!.id,
      });
      return { messageId: r.rows[0]!.id };
    });
  }

  // ---- credits ---------------------------------------------------------------------------------
  /** Balance per channel: top-ups minus units of messages handed to the provider. */
  async balances(c: PoolClient) {
    const r = await c.query<{ channel: ProviderChannel; credited: string; used: string }>(
      `SELECT ch.channel,
              COALESCE((SELECT sum(units) FROM comms_credits k WHERE k.channel = ch.channel::comms_channel), 0)::text AS credited,
              COALESCE((SELECT sum(units) FROM comms_messages m WHERE m.channel = ch.channel::comms_channel AND m.sent_at IS NOT NULL), 0)::text AS used
         FROM (VALUES ('sms'), ('whatsapp'), ('email')) AS ch(channel)`,
    );
    const policy = await this.policy(c);
    return r.rows.map((x) => {
      const balance = Number(x.credited) - Number(x.used);
      const low = policy.lowBalance[x.channel];
      return {
        channel: x.channel,
        credited: Number(x.credited),
        used: Number(x.used),
        balance,
        tracked: Number(x.credited) > 0,
        low: Number(x.credited) > 0 && low !== undefined && balance < low,
      };
    });
  }

  async credits(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ledger = await c.query<{
        id: string;
        channel: string;
        units: string;
        amount: string | null;
        note: string | null;
        on_date: string;
        by: string | null;
      }>(
        `SELECT k.id::text, k.channel::text, k.units::text, k.amount::text, k.note, to_char(k.on_date, 'YYYY-MM-DD') AS on_date, u.display_name AS by
           FROM comms_credits k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.on_date DESC, k.id DESC LIMIT 200`,
      );
      return {
        balances: await this.balances(c),
        ledger: ledger.rows.map((x) => ({
          id: x.id,
          channel: x.channel,
          units: Number(x.units),
          amount: x.amount === null ? null : Number(x.amount),
          note: x.note,
          onDate: x.on_date,
          by: x.by,
        })),
      };
    });
  }

  async addCredit(ctx: RequestContext, dto: CreditDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO comms_credits (school_id, channel, units, amount, note, on_date, created_by)
         VALUES (app.current_school_id(), $1::comms_channel, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), app.current_user_id()) RETURNING id::text`,
        [dto.channel, dto.units, dto.amount ?? null, dto.note ?? null, dto.onDate ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'comms.credit.add',
        entityType: 'comms_credits',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return { balances: await this.balances(c) };
    });
  }
}
