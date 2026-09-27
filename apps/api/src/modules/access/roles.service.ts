import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateRoleDto, UpdateRoleDto } from './access.dto';
import { AccessService } from './access.service';

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  kind: 'global' | 'module';
  isSystem: boolean;
  schoolId: string | null;
  description: string;
  status: 'active' | 'inactive';
  permissions: string[];
  activeAssignments: number;
}

const ROLE_SELECT = `
  SELECT r.id::text, r.code, r.name, r.kind, r.is_system, r.school_id::text, r.description, r.status,
         COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
         (SELECT count(*)::int FROM user_roles ur WHERE ur.role_id = r.id AND ur.revoked_at IS NULL
             AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)) AS active_assignments
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id`;

interface RoleDbRow {
  id: string;
  code: string;
  name: string;
  kind: 'global' | 'module';
  is_system: boolean;
  school_id: string | null;
  description: string;
  status: 'active' | 'inactive';
  permissions: string[];
  active_assignments: number;
}

const toRole = (x: RoleDbRow): RoleRow => ({
  id: x.id,
  code: x.code,
  name: x.name,
  kind: x.kind,
  isSystem: x.is_system,
  schoolId: x.school_id,
  description: x.description,
  status: x.status,
  permissions: x.permissions,
  activeAssignments: x.active_assignments,
});

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  list(tenant: TenantContext): Promise<RoleRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<RoleDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `${ROLE_SELECT} WHERE r.deleted_at IS NULL GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
      );
      return r.rows.map(toRole);
    });
  }

  async get(tenant: TenantContext, id: string, client?: PoolClient): Promise<RoleRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<RoleDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `${ROLE_SELECT} WHERE r.id = $1 AND r.deleted_at IS NULL GROUP BY r.id`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Role not found');
      return toRole(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async create(ctx: RequestContext, dto: CreateRoleDto): Promise<RoleRow> {
    const tenant = requireTenant(ctx);
    const created = await this.db.tenant(tenant, async (c) => {
      const clash = await c.query(`SELECT 1 FROM roles WHERE code = $1 AND deleted_at IS NULL`, [
        dto.code,
      ]);
      if ((clash.rowCount ?? 0) > 0)
        throw new DomainError(
          'conflict',
          `Role code "${dto.code}" already exists or is a system template`,
        );

      let permissions = dto.permissions;
      if (dto.copyFromRoleId) {
        const source = await this.get(tenant, dto.copyFromRoleId, c);
        permissions = [...new Set([...source.permissions, ...permissions])];
      }
      await this.assertPermissionsExist(c, permissions);

      const r = await c.query<{ id: string }>(
        `INSERT INTO roles (school_id, code, name, kind, is_system, description, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::role_kind, false, $4, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [dto.code, dto.name, dto.kind, dto.description],
      );
      const id = r.rows[0]!.id;
      await this.replacePermissions(c, id, permissions);
      return this.get(tenant, id, c);
    });
    ctx.audit = {
      action: 'access.role.create',
      entityType: 'roles',
      entityId: created.id,
      after: created,
    };
    return created;
  }

  async update(ctx: RequestContext, id: string, dto: UpdateRoleDto): Promise<RoleRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, id, c);
      if (before.isSystem)
        throw new DomainError(
          'role.immutable',
          'System role templates cannot be edited; copy them into a school role',
          { status: 403 },
        );
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.description !== undefined) set('description', dto.description);
      if (dto.status !== undefined) set('status', dto.status);
      params.push(id);
      // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
      await c.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if (dto.permissions !== undefined) {
        await this.assertPermissionsExist(c, dto.permissions);
        await this.replacePermissions(c, id, dto.permissions);
      }
      const after = await this.get(tenant, id, c);
      return { before, after };
    });
    // Permissions or status changed for every holder of this role.
    await this.access.invalidateSchool(tenant.schoolId);
    ctx.audit = {
      action: 'access.role.edit',
      entityType: 'roles',
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  async disable(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    const before = await this.db.tenant(tenant, async (c) => {
      const role = await this.get(tenant, id, c);
      if (role.isSystem)
        throw new DomainError('role.immutable', 'System role templates cannot be deleted', {
          status: 403,
        });
      if (role.activeAssignments > 0) {
        throw new DomainError(
          'role.in_use',
          `Role has ${role.activeAssignments} active assignment(s); revoke them first`,
          {
            status: 409,
            extra: { activeAssignments: role.activeAssignments },
          },
        );
      }
      await c.query(
        `UPDATE roles SET status = 'inactive', deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return role;
    });
    ctx.audit = { action: 'access.role.delete', entityType: 'roles', entityId: id, before };
  }

  private async assertPermissionsExist(c: PoolClient, codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    const r = await c.query<{ code: string }>(
      `SELECT code FROM permissions WHERE code = ANY($1::text[]) AND orphaned = false`,
      [codes],
    );
    const known = new Set(r.rows.map((x) => x.code));
    const unknown = codes.filter((x) => !known.has(x));
    if (unknown.length > 0) {
      throw new DomainError(
        'validation-failed',
        `Unknown permission code(s): ${unknown.join(', ')}`,
        { status: 400, extra: { unknown } },
      );
    }
  }

  private async replacePermissions(c: PoolClient, roleId: string, codes: string[]): Promise<void> {
    await c.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    if (codes.length === 0) return;
    await c.query(
      `INSERT INTO role_permissions (role_id, permission_code, created_by)
       SELECT $1, unnest($2::text[]), app.current_user_id()`,
      [roleId, codes],
    );
  }
}
