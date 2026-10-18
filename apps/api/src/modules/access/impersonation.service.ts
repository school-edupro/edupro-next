import { Inject, Injectable } from '@nestjs/common';
import { SignJWT } from 'jose';
import type { TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { SecurityEventsService } from '../../common/security/security-events.service';
import { ENV, type Env } from '../../config/env';
import type { StartImpersonationDto } from './access.dto';

export interface ImpersonationRow {
  id: string;
  actorUserId: string;
  actorName: string;
  targetUserId: string;
  targetName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  active: boolean;
}

interface DbRow {
  id: string;
  actor_user_id: string;
  actor_name: string;
  target_user_id: string;
  target_name: string;
  reason: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
}

const SELECT = `SELECT s.id::text, s.actor_user_id::text, a.display_name AS actor_name, s.target_user_id::text, t.display_name AS target_name,
         s.reason, s.started_at, s.expires_at, s.ended_at
    FROM impersonation_sessions s JOIN users a ON a.id = s.actor_user_id JOIN users t ON t.id = s.target_user_id`;

const toRow = (x: DbRow): ImpersonationRow => ({
  id: x.id,
  actorUserId: x.actor_user_id,
  actorName: x.actor_name,
  targetUserId: x.target_user_id,
  targetName: x.target_name,
  reason: x.reason,
  startedAt: x.started_at.toISOString(),
  expiresAt: x.expires_at.toISOString(),
  endedAt: x.ended_at ? x.ended_at.toISOString() : null,
  active: x.ended_at === null && x.expires_at.getTime() > Date.now(),
});

/**
 * Impersonation (S5-02): a support engineer or administrator acts as another member for a short, reasoned,
 * audited window. The session token carries the target subject and the session id; the guard re-checks the
 * session on every request, so ending it takes effect immediately. Privileged (MFA) actions are refused
 * while impersonating.
 */
@Injectable()
export class ImpersonationService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly security: SecurityEventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async start(ctx: RequestContext, dto: StartImpersonationDto) {
    return this.open(ctx, { ...dto, mode: 'full', app: 'admin' });
  }

  /**
   * A session as another member: the admin app's own ('full'), or a portal opened as a student, parent or
   * employee ('view' / 'act', 0183). Returns the session and its token.
   */
  async open(
    ctx: RequestContext,
    dto: {
      userId: string;
      reason: string;
      minutes: number;
      mode: 'full' | 'view' | 'act';
      app: 'admin' | 'parent' | 'teacher';
      personType?: 'student' | 'guardian' | 'employee';
      personRefId?: string;
    },
  ) {
    const tenant = requireTenant(ctx);
    if (ctx.user.impersonation)
      throw new DomainError('impersonation.nested', 'Already impersonating', { status: 409 });
    if (dto.userId === ctx.user.id)
      throw new DomainError('impersonation.self', 'You cannot impersonate yourself', {
        status: 409,
      });
    const minutes = Math.min(dto.minutes, this.env.IMPERSONATION_MAX_MINUTES);
    const row = await this.db.tenant(tenant, async (c) => {
      const target = await c.query<{ id: string; oneauth_sub: string; display_name: string }>(
        `SELECT u.id::text, u.oneauth_sub, u.display_name FROM users u
           JOIN user_school_memberships m ON m.user_id = u.id AND m.school_id = app.current_school_id() AND m.status = 'active' AND m.deleted_at IS NULL
          WHERE u.id = $1 AND u.deleted_at IS NULL AND u.status = 'active' LIMIT 1`,
        [dto.userId],
      );
      const t = target.rows[0];
      if (!t)
        throw new DomainError(
          'user.not_member',
          'The user is not an active member of this school',
          { status: 409 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO impersonation_sessions (school_id, actor_user_id, target_user_id, reason, expires_at, request_id, mode, app, person_type, person_ref_id)
         VALUES (app.current_school_id(), app.current_user_id(), $1, $2, now() + make_interval(mins => $3), app.current_request_id(), $4, $5, $6, $7) RETURNING id::text`,
        [
          dto.userId,
          dto.reason,
          minutes,
          dto.mode,
          dto.app,
          dto.personType ?? null,
          dto.personRefId ?? null,
        ],
      );
      const session = (await c.query<DbRow>(SELECT + ' WHERE s.id = $1', [r.rows[0]!.id])).rows[0]!;
      await c.query(
        `INSERT INTO login_events (user_id, school_id, method, outcome, ip, user_agent, detail)
         VALUES ($1, app.current_school_id(), 'impersonation', 'success', $2::inet, $3, $4::jsonb)`,
        [
          dto.userId,
          ctx.ip ?? null,
          ctx.userAgent ?? null,
          JSON.stringify({
            sessionId: session.id,
            actorUserId: ctx.user.id,
            mode: dto.mode,
            app: dto.app,
          }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'access.session.impersonate.start',
        entityType: 'impersonation_sessions',
        entityId: session.id,
        after: {
          targetUserId: dto.userId,
          targetName: t.display_name,
          reason: dto.reason,
          expiresAt: session.expires_at.toISOString(),
          mode: dto.mode,
          app: dto.app,
        },
      });
      return { session, sub: t.oneauth_sub };
    });
    const token = await this.sign(row.session.id, tenant.schoolId, row.sub, row.session.expires_at);
    this.security.record('impersonation_start', { schoolId: tenant.schoolId, userId: ctx.user.id });
    return { session: toRow(row.session), token };
  }

  /** The session token: the target's subject and the session id; good until the session ends. */
  async sign(sessionId: string, schoolId: string, sub: string, expiresAt: Date): Promise<string> {
    const token = await new SignJWT({ jti: sessionId, sid: schoolId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('edupro-impersonation')
      .setAudience('edupro-impersonation')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(this.env.IMPERSONATION_JWT_SECRET));
    return `imp.${token}`;
  }

  async end(ctx: RequestContext, id: string): Promise<ImpersonationRow> {
    const tenant = requireTenant(ctx);
    const row = await this.db.tenant(tenant, async (c) => {
      const cur = (await c.query<DbRow>(SELECT + ' WHERE s.id = $1', [id])).rows[0];
      if (!cur) throw new DomainError('not-found', 'Impersonation session not found');
      if (cur.ended_at) return cur;
      await c.query(
        'UPDATE impersonation_sessions SET ended_at = now(), ended_by = app.current_user_id() WHERE id = $1',
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'access.session.impersonate.end',
        entityType: 'impersonation_sessions',
        entityId: id,
        before: { active: true },
        after: { active: false },
      });
      return (await c.query<DbRow>(SELECT + ' WHERE s.id = $1', [id])).rows[0]!;
    });
    this.security.record('impersonation_end', { schoolId: tenant.schoolId, userId: ctx.user.id });
    return toRow(row);
  }

  list(tenant: TenantContext, activeOnly: boolean): Promise<ImpersonationRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<DbRow>(
        SELECT +
          ' WHERE ($1::boolean = false OR (s.ended_at IS NULL AND s.expires_at > now())) ORDER BY s.started_at DESC LIMIT 200',
        [activeOnly],
      );
      return r.rows.map(toRow);
    });
  }
}
