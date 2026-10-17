import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { encryptField, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { CacheService } from '../../common/cache/cache.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import {
  requireTenant,
  type AuthenticatedUser,
  type RequestContext,
} from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { publicTenant } from '../admissions/public/otp.service';
import type { InstanceRow } from '../workflow/workflow.service';
import { responsePayload } from './consent-events';
import type {
  ApiDecideDto,
  ApiListQueryDto,
  ApiKeyDto,
  WebhookDto,
  WebhookPatchDto,
} from './consent-forms.dto';
import { ConsentFormsService } from './consent-forms.service';

/** A request made with an API key: the key's school, form and scope. */
export interface KeyCaller {
  keyId: string;
  schoolId: string;
  formId: string;
  scope: 'read' | 'read_approve';
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}${randomBytes(24).toString('base64url')}`;

/**
 * Connecting a consent form to other systems (docs/design/28-consent-forms.md, part 4): webhooks that
 * receive each event of its answers (signed with HMAC-SHA256; the workers deliver and retry) and API keys
 * that read its answers and, with the wider scope, decide them. Set up by the school admin only.
 */
@Injectable()
export class ConsentIntegrationsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly consents: ConsentFormsService,
  ) {}

  private async form(c: PoolClient, id: string) {
    const r = await c.query<{ id: string; title: string }>(
      `SELECT id::text, title FROM consent_forms WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Form not found', { status: 404 });
    return r.rows[0];
  }

  /** A webhook address must be https (http to this machine only outside production). */
  private checkUrl(url: string) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new DomainError('consent.webhook_url', 'The address is not a valid URL', {
        status: 400,
      });
    }
    const local =
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|0\.0\.0\.0)/.test(
        u.hostname,
      );
    if (this.env.NODE_ENV === 'production' && (u.protocol !== 'https:' || local))
      throw new DomainError(
        'consent.webhook_url',
        'Use an https address on the internet (not a local or private one)',
        { status: 400 },
      );
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
      throw new DomainError('consent.webhook_url', 'Use an https address', { status: 400 });
  }

  /** The form's webhooks with their last deliveries, and its API keys. */
  async overview(ctx: RequestContext, formId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.form(c, formId);
      const hooks = await c.query<Record<string, unknown>>(
        `SELECT w.id::text, w.url, w.events, w.active, w.created_at AS "createdAt",
                (SELECT display_name FROM users WHERE id = w.created_by) AS "createdBy",
                (SELECT count(*) FROM consent_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed')::int AS failed,
                (SELECT count(*) FROM consent_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'pending')::int AS pending
           FROM consent_webhooks w WHERE w.form_id = $1 AND w.deleted_at IS NULL ORDER BY w.id`,
        [formId],
      );
      const deliveries = await c.query<Record<string, unknown>>(
        `SELECT d.id::text, d.webhook_id::text AS "webhookId", d.event, d.status, d.attempts, d.last_status AS "lastStatus",
                d.last_error AS "lastError", d.created_at AS "createdAt", d.delivered_at AS "deliveredAt", d.next_at AS "nextAt",
                d.payload #>> '{response,number}' AS number
           FROM consent_webhook_deliveries d JOIN consent_webhooks w ON w.id = d.webhook_id
          WHERE w.form_id = $1 ORDER BY d.id DESC LIMIT 50`,
        [formId],
      );
      const keys = await c.query<Record<string, unknown>>(
        `SELECT k.id::text, k.name, k.prefix, k.scope, k.expires_at AS "expiresAt", k.last_used_at AS "lastUsedAt", k.uses::int AS uses,
                k.revoked_at AS "revokedAt", k.created_at AS "createdAt", (SELECT display_name FROM users WHERE id = k.created_by) AS "createdBy"
           FROM consent_api_keys k WHERE k.form_id = $1 ORDER BY k.revoked_at IS NOT NULL, k.id DESC`,
        [formId],
      );
      return { webhooks: hooks.rows, deliveries: deliveries.rows, keys: keys.rows };
    });
  }

  /** A new webhook; its signing secret is shown this once. */
  async addWebhook(ctx: RequestContext, formId: string, dto: WebhookDto) {
    this.checkUrl(dto.url);
    const secret = token('whsec_');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.form(c, formId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO consent_webhooks (school_id, form_id, url, secret, events, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::text[], app.current_user_id()) RETURNING id::text`,
        [formId, dto.url, encryptField(secret), dto.events],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.webhook_add',
        entityType: 'consent_webhooks',
        entityId: r.rows[0]!.id,
        after: { formId, url: dto.url, events: dto.events },
      });
      return { id: r.rows[0]!.id, secret };
    });
  }

  async updateWebhook(ctx: RequestContext, formId: string, hookId: string, dto: WebhookPatchDto) {
    if (dto.url) this.checkUrl(dto.url);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_webhooks SET url = COALESCE($3, url), events = COALESCE($4::text[], events), active = COALESCE($5, active), updated_at = now()
          WHERE id = $1 AND form_id = $2 AND deleted_at IS NULL`,
        [hookId, formId, dto.url ?? null, dto.events ?? null, dto.active ?? null],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Webhook not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.webhook_update',
        entityType: 'consent_webhooks',
        entityId: hookId,
        after: dto,
      });
      return { ok: true };
    });
  }

  /** A new signing secret (shown once); the old one stops being used. */
  async rotateSecret(ctx: RequestContext, formId: string, hookId: string) {
    const secret = token('whsec_');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_webhooks SET secret = $3, updated_at = now() WHERE id = $1 AND form_id = $2 AND deleted_at IS NULL`,
        [hookId, formId, encryptField(secret)],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Webhook not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.webhook_secret',
        entityType: 'consent_webhooks',
        entityId: hookId,
      });
      return { secret };
    });
  }

  async removeWebhook(ctx: RequestContext, formId: string, hookId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_webhooks SET deleted_at = now(), active = false WHERE id = $1 AND form_id = $2 AND deleted_at IS NULL`,
        [hookId, formId],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Webhook not found', { status: 404 });
      await c.query(
        `UPDATE consent_webhook_deliveries SET status = 'failed', last_error = 'Webhook removed' WHERE webhook_id = $1 AND status = 'pending'`,
        [hookId],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.webhook_remove',
        entityType: 'consent_webhooks',
        entityId: hookId,
      });
      return { ok: true };
    });
  }

  /** A test message to the webhook (event "test"), delivered like the others. */
  async test(ctx: RequestContext, formId: string, hookId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const f = await this.form(c, formId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO consent_webhook_deliveries (school_id, webhook_id, event, payload)
         SELECT app.current_school_id(), w.id, 'test', $3::jsonb FROM consent_webhooks w
          WHERE w.id = $1 AND w.form_id = $2 AND w.deleted_at IS NULL RETURNING id::text`,
        [
          hookId,
          formId,
          JSON.stringify({
            event: 'test',
            sentAt: new Date().toISOString(),
            form: { id: f.id, title: f.title },
          }),
        ],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Webhook not found', { status: 404 });
      return { deliveryId: r.rows[0].id };
    });
  }

  /** Sends a delivery again (from now, its attempts counted afresh). */
  async redeliver(ctx: RequestContext, formId: string, deliveryId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_webhook_deliveries d SET status = 'pending', attempts = 0, next_at = now(), last_error = NULL
           FROM consent_webhooks w WHERE w.id = d.webhook_id AND d.id = $1 AND w.form_id = $2 AND w.deleted_at IS NULL`,
        [deliveryId, formId],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Delivery not found', { status: 404 });
      return { ok: true };
    });
  }

  /** A new API key for the form; the key is shown this once and kept only as a hash. */
  async addKey(ctx: RequestContext, formId: string, dto: ApiKeyDto) {
    const key = token('cfk_');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.form(c, formId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO consent_api_keys (school_id, form_id, name, prefix, key_hash, scope, expires_at, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::date + interval '1 day' - interval '1 second', app.current_user_id()) RETURNING id::text`,
        [formId, dto.name, key.slice(0, 12), sha(key), dto.scope, dto.expiresOn ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.key_add',
        entityType: 'consent_api_keys',
        entityId: r.rows[0]!.id,
        after: { formId, name: dto.name, scope: dto.scope, expiresOn: dto.expiresOn ?? null },
      });
      return { id: r.rows[0]!.id, key };
    });
  }

  async revokeKey(ctx: RequestContext, formId: string, keyId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE consent_api_keys SET revoked_at = now() WHERE id = $1 AND form_id = $2 AND revoked_at IS NULL`,
        [keyId, formId],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Key not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'engagement.consent_form.key_revoke',
        entityType: 'consent_api_keys',
        entityId: keyId,
      });
      return { ok: true };
    });
  }

  // ---- the API, with a key ------------------------------------------------------------------------
  /** The key's form and scope; refused when unknown, revoked, expired or over 60 calls a minute. */
  async caller(header: string | undefined): Promise<KeyCaller> {
    const raw = (header ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!raw.startsWith('cfk_'))
      throw new DomainError('consent.api_key', 'Send the form’s API key as a Bearer token', {
        status: 401,
      });
    const row = await this.db.global(async (c) => {
      const r = await c.query<{
        key_id: string;
        school_id: string;
        form_id: string;
        scope: 'read' | 'read_approve';
        expires_at: Date | null;
        revoked_at: Date | null;
      }>(
        `SELECT key_id::text, school_id::text, form_id::text, scope, expires_at, revoked_at FROM app.consent_api_key_lookup($1)`,
        [sha(raw)],
      );
      return r.rows[0] ?? null;
    });
    if (!row || row.revoked_at || (row.expires_at && row.expires_at.getTime() < Date.now()))
      throw new DomainError('consent.api_key', 'The API key is not valid', { status: 401 });
    const n = await this.cache.incr(`consent-api:${row.key_id}`, 60);
    if (n > 60)
      throw new DomainError('rate-limited', 'Over 60 calls a minute; wait a little', {
        status: 429,
      });
    await this.db.tenant(publicTenant(row.school_id), (c) =>
      c.query(`UPDATE consent_api_keys SET last_used_at = now(), uses = uses + 1 WHERE id = $1`, [
        row.key_id,
      ]),
    );
    return { keyId: row.key_id, schoolId: row.school_id, formId: row.form_id, scope: row.scope };
  }

  /** The form's answers, newest first, changed since a time if asked, page by page. */
  async apiList(k: KeyCaller, q: ApiListQueryDto) {
    return this.db.tenant(publicTenant(k.schoolId), async (c) => {
      const params: unknown[] = [k.formId];
      let since = '';
      if (q.since) {
        params.push(q.since);
        since = `AND COALESCE(x.updated_at, x.signed_at) >= $${params.length}::timestamptz`;
      }
      params.push(q.size, (q.page - 1) * q.size);
      const ids = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragment; values are bound parameters
        `SELECT x.id::text FROM consent_form_responses x WHERE x.form_id = $1 AND x.status <> 'withdrawn' ${since}
          ORDER BY x.signed_at DESC, x.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const data = [];
      for (const r of ids.rows) {
        const p = await responsePayload(c, r.id);
        if (p) data.push(p.response);
      }
      const form = await c.query<{ id: string; code: string; title: string; status: string }>(
        `SELECT id::text, code, title, status FROM consent_forms WHERE id = $1`,
        [k.formId],
      );
      return { form: form.rows[0], page: q.page, size: q.size, data };
    });
  }

  /** One answer by its number (CF/…) or id. */
  async apiOne(k: KeyCaller, ref: string) {
    return this.db.tenant(publicTenant(k.schoolId), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM consent_form_responses WHERE form_id = $1 AND (number = $2 OR id::text = $2)`,
        [k.formId, ref],
      );
      const p = r.rows[0] ? await responsePayload(c, r.rows[0].id) : null;
      if (!p) throw new DomainError('not-found', 'Answer not found', { status: 404 });
      return p.response;
    });
  }

  /**
   * Approves or rejects an answer for the outside system (scope read_approve): the waiting levels are
   * decided at once in its name, then the decision follows as in the school (fee, family told, webhook).
   */
  async apiDecide(k: KeyCaller, ref: string, dto: ApiDecideDto, requestId: string) {
    if (k.scope !== 'read_approve')
      throw new DomainError('consent.api_scope', 'This key may only read', { status: 403 });
    const ctx = {
      requestId,
      user: {
        id: null as unknown as string,
        sub: 'api-key',
        displayName: 'API key',
        memberships: [],
      } as unknown as AuthenticatedUser,
      tenant: publicTenant(k.schoolId, requestId),
    } as RequestContext;
    return this.db.tenant(publicTenant(k.schoolId, requestId), async (c) => {
      const r = await c.query<{ id: string; status: string; instance_id: string | null }>(
        `SELECT id::text, status, instance_id::text FROM consent_form_responses WHERE form_id = $1 AND (number = $2 OR id::text = $2) FOR UPDATE`,
        [k.formId, ref],
      );
      const row = r.rows[0];
      if (!row) throw new DomainError('not-found', 'Answer not found', { status: 404 });
      const name = (
        await c.query<{ name: string }>(`SELECT name FROM consent_api_keys WHERE id = $1`, [
          k.keyId,
        ])
      ).rows[0]?.name;
      const note = `${dto.note ? `${dto.note} ` : ''}(by API key "${name ?? k.keyId}")`.slice(
        0,
        500,
      );
      const inst = row.instance_id
        ? (
            await c.query<{ id: string; status: string }>(
              `SELECT id::text, status FROM workflow_instances WHERE id = $1 FOR UPDATE`,
              [row.instance_id],
            )
          ).rows[0]
        : null;
      if (!inst || inst.status !== 'pending' || row.status !== 'submitted')
        throw new DomainError('consent.api_decide', 'This answer is not waiting for approval', {
          status: 409,
        });
      await c.query(
        `UPDATE workflow_steps SET status = $2, acted_at = now(), note = $3 WHERE instance_id = $1 AND status = 'pending'`,
        [inst.id, dto.decision, note],
      );
      await c.query(
        `UPDATE workflow_instances SET status = $2, completed_at = now(), updated_at = now() WHERE id = $1`,
        [inst.id, dto.decision],
      );
      await this.consents.onDecision(
        c,
        ctx,
        { id: inst.id, entityId: row.id } as InstanceRow,
        dto.decision,
      );
      const p = await responsePayload(c, row.id);
      return p!.response;
    });
  }
}
