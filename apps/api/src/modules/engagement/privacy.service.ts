import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ConsentsService } from '../comms/consents.service';
import type { AcknowledgeDto, PublishNoticeDto } from './engagement.dto';

export interface NoticeRow {
  version: number;
  title: string;
  body: string;
  bodyHi: string | null;
  publishedAt: string | null;
}

/** DPDP privacy notice versions and the family's onboarding (notice acknowledgement + consent capture), S11. */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly consents: ConsentsService,
  ) {}

  async current(c: PoolClient): Promise<NoticeRow | null> {
    const r = await c.query<{
      version: number;
      title: string;
      body: string;
      body_hi: string | null;
      published_at: Date | null;
    }>(
      `SELECT version, title, body, body_hi, published_at FROM privacy_notices WHERE published_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
    );
    const x = r.rows[0];
    return x
      ? {
          version: x.version,
          title: x.title,
          body: x.body,
          bodyHi: x.body_hi,
          publishedAt: x.published_at ? x.published_at.toISOString() : null,
        }
      : null;
  }

  async notices(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        version: number;
        title: string;
        body: string;
        body_hi: string | null;
        published_at: Date | null;
        acknowledgements: number;
      }>(
        `SELECT n.version, n.title, n.body, n.body_hi, n.published_at, (SELECT count(*)::int FROM privacy_acknowledgements a WHERE a.notice_version = n.version) AS acknowledgements
           FROM privacy_notices n ORDER BY n.version DESC`,
      );
      return {
        data: r.rows.map((x) => ({
          version: x.version,
          title: x.title,
          body: x.body,
          bodyHi: x.body_hi,
          publishedAt: x.published_at ? x.published_at.toISOString() : null,
          acknowledgements: x.acknowledgements,
        })),
      };
    });
  }

  /** Publishing creates the next version; every family must acknowledge it on their next visit. */
  async publish(ctx: RequestContext, dto: PublishNoticeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ version: number }>(
        `INSERT INTO privacy_notices (school_id, version, title, body, body_hi, published_at, created_by)
         VALUES (app.current_school_id(), COALESCE((SELECT max(version) FROM privacy_notices), 0) + 1, $1, $2, $3, now(), app.current_user_id()) RETURNING version`,
        [dto.title, dto.body, dto.bodyHi ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.privacy.publish',
        entityType: 'privacy_notices',
        entityId: String(r.rows[0]!.version),
        after: { title: dto.title, version: r.rows[0]!.version },
      });
      return this.current(c);
    });
  }

  /** What the parent app shows on first visit: the notice to acknowledge (if any) and the consent purposes. */
  async onboarding(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), (c) => this.onboardingWith(c, ctx));
  }

  private async onboardingWith(c: PoolClient, ctx: RequestContext) {
    {
      await this.consents.installDefaults(c);
      const notice = await this.current(c);
      const ack = notice
        ? await c.query<{ at: Date }>(
            `SELECT acknowledged_at AS at FROM privacy_acknowledgements WHERE user_id = app.current_user_id() AND notice_version = $1`,
            [notice.version],
          )
        : { rows: [] as Array<{ at: Date }> };
      return {
        notice,
        acknowledged: notice ? (ack.rows[0]?.at.toISOString() ?? null) : null,
        required: !!notice && !ack.rows[0],
        purposes: await this.consents.statusFor(c, ctx.user.id),
      };
    }
  }

  async acknowledge(ctx: RequestContext, dto: AcknowledgeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const notice = await this.current(c);
      if (!notice || notice.version !== dto.version)
        throw new DomainError(
          'privacy.version_stale',
          'The privacy notice has changed; please read the current version',
          { status: 409, extra: { current: notice?.version ?? null } },
        );
      await c.query(
        `INSERT INTO privacy_acknowledgements (school_id, user_id, notice_version, source, ip) VALUES (app.current_school_id(), app.current_user_id(), $1, 'parent_app', $2::inet) ON CONFLICT (user_id, notice_version) DO NOTHING`,
        [dto.version, ctx.ip ?? null],
      );
      for (const item of dto.consents) {
        const p = await c.query<{ version: number; is_required: boolean }>(
          `SELECT version, is_required FROM consent_purposes WHERE code = $1`,
          [item.purposeCode],
        );
        if (!p.rows[0]) continue;
        if (p.rows[0].is_required && item.status === 'withdrawn') continue;
        await c.query(
          `INSERT INTO consents (school_id, user_id, purpose_code, status, version, source, recorded_by) VALUES (app.current_school_id(), app.current_user_id(), $1, $2::consent_status, $3, 'parent_app', app.current_user_id())`,
          [item.purposeCode, item.status, p.rows[0].version],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'privacy.acknowledge',
        entityType: 'privacy_acknowledgements',
        entityId: ctx.user.id,
        after: { version: dto.version, consents: dto.consents.length },
      });
      return this.onboardingWith(c, ctx);
    });
  }
}
