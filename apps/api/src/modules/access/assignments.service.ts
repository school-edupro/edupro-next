import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  GrantDto,
  ListAssignmentsQueryDto,
  SetScopesDto,
  UpdateAssignmentDto,
} from './access.dto';
import { AccessService, type ScopeType } from './access.service';
import { RolesService } from './roles.service';

export interface AssignmentRow {
  id: string;
  userId: string;
  userName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  campusId: string | null;
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  reason: string | null;
  revokedAt: string | null;
  active: boolean;
  scopes: Array<{ type: ScopeType; id: string }>;
}

interface AssignmentDbRow {
  id: string;
  user_id: string;
  user_name: string;
  role_id: string;
  role_code: string;
  role_name: string;
  campus_id: string | null;
  valid_from: string;
  valid_to: string | null;
  granted_by: string | null;
  reason: string | null;
  revoked_at: Date | null;
  active: boolean;
  scopes: Array<{ type: ScopeType; id: string }> | null;
}

const ASSIGNMENT_SELECT = `
  SELECT ur.id::text, ur.user_id::text, u.display_name AS user_name, ur.role_id::text, r.code AS role_code, r.name AS role_name,
         ur.campus_id::text, to_char(ur.valid_from, 'YYYY-MM-DD') AS valid_from, to_char(ur.valid_to, 'YYYY-MM-DD') AS valid_to,
         ur.granted_by::text, ur.reason, ur.revoked_at,
         (ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)) AS active,
         (SELECT json_agg(json_build_object('type', s.scope_type, 'id', s.scope_id::text) ORDER BY s.scope_type, s.scope_id)
            FROM user_role_scopes s WHERE s.user_role_id = ur.id) AS scopes
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN roles r ON r.id = ur.role_id`;

const toAssignment = (x: AssignmentDbRow): AssignmentRow => ({
  id: x.id,
  userId: x.user_id,
  userName: x.user_name,
  roleId: x.role_id,
  roleCode: x.role_code,
  roleName: x.role_name,
  campusId: x.campus_id,
  validFrom: x.valid_from,
  validTo: x.valid_to,
  grantedBy: x.granted_by,
  reason: x.reason,
  revokedAt: x.revoked_at ? x.revoked_at.toISOString() : null,
  active: x.active,
  scopes: x.scopes ?? [],
});

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly roles: RolesService,
  ) {}

  list(
    tenant: TenantContext,
    q: ListAssignmentsQueryDto,
  ): Promise<{ rows: AssignmentRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['1=1'];
      const params: unknown[] = [];
      if (q.userId) {
        params.push(q.userId);
        where.push(`ur.user_id = $${params.length}`);
      }
      if (q.roleId) {
        params.push(q.roleId);
        where.push(`ur.role_id = $${params.length}`);
      }
      if (q.active === 'true')
        where.push(
          `ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
        );
      if (q.active === 'false')
        where.push(
          `NOT (ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE))`,
        );
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM user_roles ur WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<AssignmentDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `${ASSIGNMENT_SELECT} WHERE ${whereSql} ORDER BY u.display_name, r.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { rows: r.rows.map(toAssignment), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async get(tenant: TenantContext, id: string, client?: PoolClient): Promise<AssignmentRow> {
    const run = async (c: PoolClient) => {
      // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
      const r = await c.query<AssignmentDbRow>(`${ASSIGNMENT_SELECT} WHERE ur.id = $1`, [id]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Assignment not found');
      return toAssignment(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async grant(ctx: RequestContext, dto: GrantDto): Promise<AssignmentRow> {
    const tenant = requireTenant(ctx);

    const conflict = await this.access.sodConflictForGrant(tenant, dto.userId, dto.roleId);
    if (conflict) {
      throw new DomainError(
        'sod-conflict',
        `Granting this role would let the user hold both ${conflict.a} and ${conflict.b}`,
        {
          status: 409,
          extra: { permissionA: conflict.a, permissionB: conflict.b },
        },
      );
    }

    const created = await this.db.tenant(tenant, async (c) => {
      const member = await c.query(
        `SELECT 1 FROM user_school_memberships WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
        [dto.userId],
      );
      if ((member.rowCount ?? 0) === 0)
        throw new DomainError(
          'user.not_member',
          'The user is not an active member of this school',
          { status: 409 },
        );

      const role = await this.roles.get(tenant, dto.roleId, c);
      if (role.status !== 'active')
        throw new DomainError('role.inactive', 'The role is inactive', { status: 409 });

      if (dto.campusId) {
        const campus = await c.query(
          `SELECT 1 FROM campuses WHERE id = $1 AND deleted_at IS NULL`,
          [dto.campusId],
        );
        if ((campus.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Campus not found');
      }

      const dup = await c.query(
        `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND campus_id IS NOT DISTINCT FROM $3
          AND revoked_at IS NULL AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
        [dto.userId, dto.roleId, dto.campusId ?? null],
      );
      if ((dup.rowCount ?? 0) > 0)
        throw new DomainError('conflict', 'The user already holds this role for this campus');

      const r = await c.query<{ id: string }>(
        `INSERT INTO user_roles (school_id, user_id, role_id, campus_id, valid_from, valid_to, granted_by, reason, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5::date, app.current_user_id(), $6,
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.userId,
          dto.roleId,
          dto.campusId ?? null,
          dto.validFrom ?? null,
          dto.validTo ?? null,
          dto.reason,
        ],
      );
      const id = r.rows[0]!.id;
      await this.replaceScopes(c, id, dto.scopes);
      return this.get(tenant, id, c);
    });

    await this.access.invalidateUser(tenant.schoolId, dto.userId);
    ctx.audit = {
      action: 'access.assignment.grant',
      entityType: 'user_roles',
      entityId: created.id,
      after: created,
    };
    return created;
  }

  async update(ctx: RequestContext, id: string, dto: UpdateAssignmentDto): Promise<AssignmentRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      if (before.revokedAt)
        throw new DomainError('assignment.revoked', 'A revoked assignment cannot be changed', {
          status: 409,
        });
      await c.query(
        `UPDATE user_roles SET valid_to = CASE WHEN $2::boolean THEN $3::date ELSE valid_to END,
                               campus_id = CASE WHEN $4::boolean THEN $5 ELSE campus_id END,
                               updated_by = app.current_user_id()
          WHERE id = $1`,
        [
          id,
          dto.validTo !== undefined,
          dto.validTo ?? null,
          dto.campusId !== undefined,
          dto.campusId ?? null,
        ],
      );
      return { before, after: await this.get(tenant, id, c) };
    });
    await this.access.invalidateUser(tenant.schoolId, result.after.userId);
    ctx.audit = {
      action: 'access.assignment.edit',
      entityType: 'user_roles',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  async revoke(ctx: RequestContext, id: string, reason: string): Promise<AssignmentRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      if (before.revokedAt)
        throw new DomainError('assignment.revoked', 'Already revoked', { status: 409 });
      await c.query(
        `UPDATE user_roles SET revoked_at = now(), revoked_by = app.current_user_id(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return { before, after: await this.get(tenant, id, c) };
    });
    await this.access.invalidateUser(tenant.schoolId, result.after.userId);
    ctx.audit = {
      action: 'access.assignment.revoke',
      entityType: 'user_roles',
      entityId: id,
      before: result.before,
      after: { ...result.after, revokeReason: reason },
    };
    return result.after;
  }

  async setScopes(ctx: RequestContext, id: string, dto: SetScopesDto): Promise<AssignmentRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      if (before.revokedAt)
        throw new DomainError('assignment.revoked', 'A revoked assignment cannot be changed', {
          status: 409,
        });
      await this.replaceScopes(c, id, dto.scopes);
      return { before, after: await this.get(tenant, id, c) };
    });
    await this.access.invalidateUser(tenant.schoolId, result.after.userId);
    ctx.audit = {
      action: 'access.assignment.scopes',
      entityType: 'user_roles',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  private async replaceScopes(
    c: PoolClient,
    assignmentId: string,
    scopes: Array<{ type: ScopeType; id: string }>,
  ): Promise<void> {
    await c.query(`DELETE FROM user_role_scopes WHERE user_role_id = $1`, [assignmentId]);
    for (const s of scopes) {
      if (s.type === 'class_section') {
        const ok = await c.query(
          `SELECT 1 FROM class_sections WHERE id = $1 AND deleted_at IS NULL`,
          [s.id],
        );
        if ((ok.rowCount ?? 0) === 0)
          throw new DomainError('not-found', `Class section ${s.id} not found`);
      }
      if (s.type === 'campus') {
        const ok = await c.query(`SELECT 1 FROM campuses WHERE id = $1 AND deleted_at IS NULL`, [
          s.id,
        ]);
        if ((ok.rowCount ?? 0) === 0)
          throw new DomainError('not-found', `Campus ${s.id} not found`);
      }
      // subject, department and route entities arrive with their modules; ids are stored as given until then.
      await c.query(
        `INSERT INTO user_role_scopes (school_id, user_role_id, scope_type, scope_id, created_by)
         VALUES (app.current_school_id(), $1, $2::scope_type, $3, app.current_user_id())
         ON CONFLICT DO NOTHING`,
        [assignmentId, s.type, s.id],
      );
    }
  }
}
