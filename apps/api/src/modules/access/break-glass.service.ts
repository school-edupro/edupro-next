import { Injectable } from '@nestjs/common';
import { QUEUES, type TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { SecurityEventsService } from '../../common/security/security-events.service';
import { AccessService } from './access.service';
import type { BreakGlassDto } from './access.dto';

export interface BreakGlassRow {
  id: string;
  userId: string;
  userName: string;
  roleCode: string;
  roleName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reportSentAt: string | null;
  active: boolean;
}

interface DbRow {
  id: string;
  user_id: string;
  user_name: string;
  role_code: string;
  role_name: string;
  reason: string;
  started_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  report_sent_at: Date | null;
}

const SELECT = `SELECT e.id::text, e.user_id::text, u.display_name AS user_name, r.code AS role_code, r.name AS role_name, e.reason,
         e.started_at, e.expires_at, e.revoked_at, e.report_sent_at
    FROM break_glass_events e JOIN users u ON u.id = e.user_id JOIN roles r ON r.id = e.role_id`;

const toRow = (x: DbRow): BreakGlassRow => ({
  id: x.id,
  userId: x.user_id,
  userName: x.user_name,
  roleCode: x.role_code,
  roleName: x.role_name,
  reason: x.reason,
  startedAt: x.started_at.toISOString(),
  expiresAt: x.expires_at.toISOString(),
  revokedAt: x.revoked_at ? x.revoked_at.toISOString() : null,
  reportSentAt: x.report_sent_at ? x.report_sent_at.toISOString() : null,
  active: x.revoked_at === null && x.expires_at.getTime() > Date.now(),
});

/**
 * Break-glass access (S5-03): an authorised person grants themselves a template role for at most four hours
 * with a mandatory reason. The grant is a normal assignment (so every action is audited as usual), the
 * event is recorded, the security lead is notified at once, and the maintenance job revokes the grant on
 * expiry and sends the post-review report.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly security: SecurityEventsService,
  ) {}

  async start(ctx: RequestContext, dto: BreakGlassDto): Promise<BreakGlassRow> {
    const tenant = requireTenant(ctx);
    if (ctx.user.impersonation)
      throw new DomainError('impersonation.restricted', 'Not available while impersonating', {
        status: 403,
      });
    const row = await this.db.tenant(tenant, async (c) => {
      const open = await c.query(
        'SELECT 1 FROM break_glass_events WHERE user_id = app.current_user_id() AND revoked_at IS NULL AND expires_at > now()',
      );
      if ((open.rowCount ?? 0) > 0)
        throw new DomainError(
          'break_glass.already_open',
          'A break-glass window is already open for you',
          { status: 409 },
        );
      const role = await c.query<{ id: string; name: string }>(
        "SELECT id::text, name FROM roles WHERE code = $1 AND school_id IS NULL AND is_system AND status = 'active' AND deleted_at IS NULL",
        [dto.roleCode],
      );
      if (!role.rows[0]) throw new DomainError('not-found', 'Unknown template role');
      const grant = await c.query<{ id: string }>(
        `INSERT INTO user_roles (school_id, user_id, role_id, valid_from, valid_to, granted_by, reason, created_by, updated_by)
         VALUES (app.current_school_id(), app.current_user_id(), $1, CURRENT_DATE, CURRENT_DATE, app.current_user_id(), $2, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [role.rows[0].id, `break-glass: ${dto.reason}`],
      );
      const ev = await c.query<{ id: string }>(
        `INSERT INTO break_glass_events (school_id, user_id, role_id, user_role_id, reason, expires_at, request_id)
         VALUES (app.current_school_id(), app.current_user_id(), $1, $2, $3, now() + make_interval(hours => $4), app.current_request_id()) RETURNING id::text`,
        [role.rows[0].id, grant.rows[0]!.id, dto.reason, dto.hours],
      );
      const created = (await c.query<DbRow>(SELECT + ' WHERE e.id = $1', [ev.rows[0]!.id]))
        .rows[0]!;
      await this.audit.stage(ctx, c, {
        action: 'access.break_glass.start',
        entityType: 'break_glass_events',
        entityId: created.id,
        after: {
          roleCode: dto.roleCode,
          reason: dto.reason,
          expiresAt: created.expires_at.toISOString(),
          userRoleId: grant.rows[0]!.id,
        },
      });
      // Immediate notice to the security lead through the notification service (the report follows on expiry).
      const lead = await c.query<{ email: string | null }>(
        "SELECT (app.setting('security.break_glass_email') #>> '{}') AS email",
      );
      const email = lead.rows[0]?.email;
      if (email) {
        const m = await c.query<{ id: string }>(
          `INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, status, request_id, created_by)
           VALUES (app.current_school_id(), 'email', $1, $2, $3, 'queued', app.current_request_id(), app.current_user_id()) RETURNING id::text`,
          [
            email,
            `Break-glass access opened by ${created.user_name}`,
            `${created.user_name} opened break-glass access (${created.role_name}) until ${created.expires_at.toISOString()}.\nReason: ${dto.reason}\nA report of the actions taken follows when the window closes.`,
          ],
        );
        await this.outbox.enqueue(c, ctx, QUEUES.notifications, 'comms.message', {
          messageId: m.rows[0]!.id,
        });
      }
      return created;
    });
    await this.access.invalidateUser(tenant.schoolId, ctx.user.id);
    this.security.record('break_glass_start', { schoolId: tenant.schoolId, userId: ctx.user.id });
    return toRow(row);
  }

  list(tenant: TenantContext): Promise<BreakGlassRow[]> {
    return this.db.tenant(tenant, async (c) =>
      (await c.query<DbRow>(SELECT + ' ORDER BY e.started_at DESC LIMIT 200')).rows.map(toRow),
    );
  }
}
