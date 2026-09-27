import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { InviteDto, ListMembershipsQueryDto } from './access.dto';
import { AccessService } from './access.service';

export interface MembershipRow {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  mobile: string | null;
  personType: 'employee' | 'guardian' | 'student' | 'external';
  status: 'active' | 'inactive';
  pendingFirstLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface MembershipDbRow {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  mobile: string | null;
  person_type: MembershipRow['personType'];
  status: MembershipRow['status'];
  pending: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

const SELECT = `
  SELECT m.id::text, m.user_id::text, u.display_name, u.email, u.mobile, m.person_type, m.status,
         (u.oneauth_sub LIKE 'pending:%') AS pending, u.last_login_at, m.created_at
    FROM user_school_memberships m
    JOIN users u ON u.id = m.user_id`;

const toRow = (x: MembershipDbRow): MembershipRow => ({
  id: x.id,
  userId: x.user_id,
  displayName: x.display_name,
  email: x.email,
  mobile: x.mobile,
  personType: x.person_type,
  status: x.status,
  pendingFirstLogin: x.pending,
  lastLoginAt: x.last_login_at ? x.last_login_at.toISOString() : null,
  createdAt: x.created_at.toISOString(),
});

@Injectable()
export class MembershipsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  list(
    tenant: TenantContext,
    q: ListMembershipsQueryDto,
  ): Promise<{ rows: MembershipRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['m.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (q.personType) {
        params.push(q.personType);
        where.push(`m.person_type = $${params.length}::person_type`);
      }
      if (q.q) {
        params.push(`%${q.q}%`);
        where.push(
          `(u.display_name ILIKE $${params.length} OR u.email::text ILIKE $${params.length} OR u.mobile ILIKE $${params.length})`,
        );
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM user_school_memberships m JOIN users u ON u.id = m.user_id WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<MembershipDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `${SELECT} WHERE ${whereSql} ORDER BY u.display_name LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async invite(
    ctx: RequestContext,
    dto: InviteDto,
  ): Promise<MembershipRow & { createdUser: boolean }> {
    const tenant = requireTenant(ctx);
    const created = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ user_id: string; membership_id: string; created_user: boolean }>(
        `SELECT o_user_id::text AS user_id, o_membership_id::text AS membership_id, o_created_user AS created_user FROM app.invite_user($1, $2, $3, $4, $5::person_type)`,
        [
          dto.oneauthSub ?? null,
          dto.mobile ?? null,
          dto.email ?? null,
          dto.displayName,
          dto.personType,
        ],
      );
      const row = r.rows[0]!;
      if (dto.roleId) {
        const role = await c.query(
          `SELECT 1 FROM roles WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
          [dto.roleId],
        );
        if ((role.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Role not found');
        await c.query(
          `INSERT INTO user_roles (school_id, user_id, role_id, granted_by, reason, created_by, updated_by)
           SELECT app.current_school_id(), $1, $2, app.current_user_id(), 'granted with invitation', app.current_user_id(), app.current_user_id()
           WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND revoked_at IS NULL)`,
          [row.user_id, dto.roleId],
        );
      }
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const m = await c.query<MembershipDbRow>(`${SELECT} WHERE m.id = $1`, [row.membership_id]);
      return { ...toRow(m.rows[0]!), createdUser: row.created_user };
    });
    await this.access.invalidateUser(tenant.schoolId, created.userId);
    ctx.audit = {
      action: 'access.membership.invite',
      entityType: 'user_school_memberships',
      entityId: created.id,
      after: created,
    };
    return created;
  }

  async setStatus(
    ctx: RequestContext,
    id: string,
    status: 'active' | 'inactive',
  ): Promise<MembershipRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const cur = await c.query<MembershipDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `${SELECT} WHERE m.id = $1 AND m.deleted_at IS NULL`,
        [id],
      );
      if (!cur.rows[0]) throw new DomainError('not-found', 'Membership not found');
      const before = toRow(cur.rows[0]);
      if (before.userId === ctx.user.id && status === 'inactive') {
        throw new DomainError('membership.self', 'You cannot deactivate your own membership', {
          status: 409,
        });
      }
      await c.query(
        `UPDATE user_school_memberships SET status = $2::row_status, updated_by = app.current_user_id() WHERE id = $1`,
        [id, status],
      );
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const after = await c.query<MembershipDbRow>(`${SELECT} WHERE m.id = $1`, [id]);
      return { before, after: toRow(after.rows[0]!) };
    });
    await this.access.invalidateUser(tenant.schoolId, result.after.userId);
    ctx.audit = {
      action: 'access.membership.status',
      entityType: 'user_school_memberships',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  /** Users visible to this school (shared membership), by name, email or mobile. */
  searchUsers(
    tenant: TenantContext,
    q: string,
  ): Promise<
    Array<{ id: string; displayName: string; email: string | null; mobile: string | null }>
  > {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        display_name: string;
        email: string | null;
        mobile: string | null;
      }>(
        `SELECT u.id::text, u.display_name, u.email, u.mobile
           FROM users u
          WHERE u.deleted_at IS NULL AND u.status = 'active'
            AND (u.display_name ILIKE $1 OR u.email::text ILIKE $1 OR u.mobile ILIKE $1)
          ORDER BY u.display_name LIMIT 20`,
        [`%${q}%`],
      );
      return r.rows.map((x) => ({
        id: x.id,
        displayName: x.display_name,
        email: x.email,
        mobile: x.mobile,
      }));
    });
  }
}
