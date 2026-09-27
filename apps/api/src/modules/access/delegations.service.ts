import { Injectable } from '@nestjs/common';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateDelegationDto } from './access.dto';
import { ACCESS } from './access.permissions';
import { AccessService } from './access.service';

export interface DelegationRow {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  roleId: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  revokedAt: string | null;
  active: boolean;
}

interface DelegationDbRow {
  id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  role_id: string;
  role_name: string;
  starts_at: Date;
  ends_at: Date;
  reason: string;
  revoked_at: Date | null;
  active: boolean;
}

const SELECT = `
  SELECT d.id::text, d.from_user_id::text, fu.display_name AS from_user_name, d.to_user_id::text, tu.display_name AS to_user_name,
         d.role_id::text, r.name AS role_name, d.starts_at, d.ends_at, d.reason, d.revoked_at,
         (d.revoked_at IS NULL AND now() BETWEEN d.starts_at AND d.ends_at) AS active
    FROM delegations d
    JOIN users fu ON fu.id = d.from_user_id
    JOIN users tu ON tu.id = d.to_user_id
    JOIN roles r ON r.id = d.role_id`;

const toRow = (x: DelegationDbRow): DelegationRow => ({
  id: x.id,
  fromUserId: x.from_user_id,
  fromUserName: x.from_user_name,
  toUserId: x.to_user_id,
  toUserName: x.to_user_name,
  roleId: x.role_id,
  roleName: x.role_name,
  startsAt: x.starts_at.toISOString(),
  endsAt: x.ends_at.toISOString(),
  reason: x.reason,
  revokedAt: x.revoked_at ? x.revoked_at.toISOString() : null,
  active: x.active,
});

@Injectable()
export class DelegationsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  /** Managers see every delegation; others see the ones they gave or received. */
  list(ctx: RequestContext): Promise<DelegationRow[]> {
    const tenant = requireTenant(ctx);
    const canManage = ctx.permissions?.has(ACCESS.delegationManage) ?? false;
    return this.db.tenant(tenant, async (c) => {
      const r = canManage
        ? // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
          await c.query<DelegationDbRow>(`${SELECT} ORDER BY d.starts_at DESC`)
        : await c.query<DelegationDbRow>(
            // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
            `${SELECT} WHERE d.from_user_id = app.current_user_id() OR d.to_user_id = app.current_user_id() ORDER BY d.starts_at DESC`,
          );
      return r.rows.map(toRow);
    });
  }

  async create(ctx: RequestContext, dto: CreateDelegationDto): Promise<DelegationRow> {
    const tenant = requireTenant(ctx);
    const canManage = ctx.permissions?.has(ACCESS.delegationManage) ?? false;
    const fromUserId = dto.fromUserId ?? ctx.user.id;
    if (fromUserId !== ctx.user.id && !canManage) {
      throw new DomainError(
        'permission-denied',
        'Only delegation managers may delegate on behalf of someone else',
        { status: 403 },
      );
    }
    if (fromUserId === dto.toUserId)
      throw new DomainError('validation-failed', 'A user cannot delegate to themselves', {
        status: 400,
      });

    const created = await this.db.tenant(tenant, async (c) => {
      const holds = await c.query(
        `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE) LIMIT 1`,
        [fromUserId, dto.roleId],
      );
      if ((holds.rowCount ?? 0) === 0)
        throw new DomainError(
          'delegation.role_not_held',
          'The giver does not currently hold this role',
          { status: 409 },
        );

      const member = await c.query(
        `SELECT 1 FROM user_school_memberships WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        [dto.toUserId],
      );
      if ((member.rowCount ?? 0) === 0)
        throw new DomainError(
          'user.not_member',
          'The recipient is not an active member of this school',
          { status: 409 },
        );

      const r = await c.query<{ id: string }>(
        `INSERT INTO delegations (school_id, from_user_id, to_user_id, role_id, starts_at, ends_at, reason, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
        [fromUserId, dto.toUserId, dto.roleId, dto.startsAt, dto.endsAt, dto.reason],
      );
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const row = await c.query<DelegationDbRow>(`${SELECT} WHERE d.id = $1`, [r.rows[0]!.id]);
      return toRow(row.rows[0]!);
    });

    // SoD is re-checked at action time by PermissionGuard for delegated permissions as well.
    await this.access.invalidateUser(tenant.schoolId, dto.toUserId);
    ctx.audit = {
      action: 'access.delegation.create',
      entityType: 'delegations',
      entityId: created.id,
      after: created,
    };
    return created;
  }

  async revoke(ctx: RequestContext, id: string): Promise<DelegationRow> {
    const tenant = requireTenant(ctx);
    const canManage = ctx.permissions?.has(ACCESS.delegationManage) ?? false;
    const result = await this.db.tenant(tenant, async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const cur = await c.query<DelegationDbRow>(`${SELECT} WHERE d.id = $1`, [id]);
      const before = cur.rows[0] ? toRow(cur.rows[0]) : null;
      if (!before) throw new DomainError('not-found', 'Delegation not found');
      if (before.fromUserId !== ctx.user.id && !canManage) {
        throw new DomainError(
          'permission-denied',
          'Only the giver or a delegation manager may revoke',
          { status: 403 },
        );
      }
      if (before.revokedAt)
        throw new DomainError('delegation.revoked', 'Already revoked', { status: 409 });
      await c.query(
        `UPDATE delegations SET revoked_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const after = await c.query<DelegationDbRow>(`${SELECT} WHERE d.id = $1`, [id]);
      return { before, after: toRow(after.rows[0]!) };
    });
    await this.access.invalidateUser(tenant.schoolId, result.after.toUserId);
    ctx.audit = {
      action: 'access.delegation.revoke',
      entityType: 'delegations',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }
}
