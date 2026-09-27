import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { PermissionRegistry } from '../../common/access/permission-registry';
import { CacheService } from '../../common/cache/cache.service';
import { DbService } from '../../common/db/db.service';

export type ScopeType = 'class_section' | 'subject' | 'department' | 'route' | 'campus';

const PERM_TTL_SECONDS = 300;
const permKey = (schoolId: string, userId: string) => `perm:${schoolId}:${userId}`;

/**
 * Effective permissions, scopes, segregation of duties and catalogue synchronisation (ADR-004).
 * Permission sets are cached in Redis (S2-11) and invalidated on every grant, revoke, delegation or role
 * change through invalidateUser / invalidateSchool.
 */
@Injectable()
export class AccessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncCatalogue();
  }

  /** Upserts every permission declared in code into the permissions table; flags code-declared codes that vanished. */
  async syncCatalogue(): Promise<void> {
    const declared = PermissionRegistry.all();
    if (declared.length === 0) return;
    await this.db.global(async (c) => {
      for (const p of declared) {
        await c.query(
          `INSERT INTO permissions (code, module, description, requires_mfa, orphaned, declared_in_code)
           VALUES ($1, $2, $3, $4, false, true)
           ON CONFLICT (code) DO UPDATE
             SET module = EXCLUDED.module,
                 description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE permissions.description END,
                 requires_mfa = permissions.requires_mfa OR EXCLUDED.requires_mfa,
                 orphaned = false,
                 declared_in_code = true,
                 updated_at = now()`,
          [p.code, PermissionRegistry.moduleOf(p.code), p.description ?? '', p.mfa === true],
        );
      }
      const orphaned = await c.query<{ code: string }>(
        `UPDATE permissions SET orphaned = true, updated_at = now()
         WHERE declared_in_code = true AND code <> ALL($1::text[]) AND orphaned = false RETURNING code`,
        [declared.map((p) => p.code)],
      );
      if ((orphaned.rowCount ?? 0) > 0) {
        this.logger.warn(
          `permissions in database but not in code: ${orphaned.rows.map((r) => r.code).join(', ')}`,
        );
      }
    });
    this.logger.log(`permission catalogue synchronised (${declared.length} codes)`);
  }

  // ---- effective permissions ---------------------------------------------------------------------

  /** Effective permissions of the acting user in the tenant. */
  effectivePermissions(tenant: TenantContext): Promise<ReadonlySet<string>> {
    if (!tenant.userId) return Promise.resolve(new Set());
    return this.effectivePermissionsFor(tenant, tenant.userId);
  }

  /** Effective permissions of any user in the tenant (used by SoD checks at grant time). */
  async effectivePermissionsFor(
    tenant: TenantContext,
    userId: string,
  ): Promise<ReadonlySet<string>> {
    const key = permKey(tenant.schoolId, userId);
    const cached = await this.cache.get<string[]>(key);
    if (cached) return new Set(cached);

    const codes = await this.db.tenant(tenant, (c) => this.queryPermissions(c, userId));
    await this.cache.set(key, codes, PERM_TTL_SECONDS);
    return new Set(codes);
  }

  private async queryPermissions(c: PoolClient, userId: string): Promise<string[]> {
    const r = await c.query<{ code: string }>(
      `SELECT DISTINCT rp.permission_code AS code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.status = 'active' AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = $1
          AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE
          AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
       UNION
       SELECT DISTINCT rp.permission_code
         FROM delegations d
         JOIN roles r ON r.id = d.role_id AND r.status = 'active' AND r.deleted_at IS NULL
         JOIN role_permissions rp ON rp.role_id = d.role_id
        WHERE d.to_user_id = $1
          AND d.revoked_at IS NULL
          AND now() BETWEEN d.starts_at AND d.ends_at`,
      [userId],
    );
    return r.rows.map((x) => x.code);
  }

  async invalidateUser(schoolId: string, userId: string): Promise<void> {
    await this.cache.del(permKey(schoolId, userId));
  }

  async invalidateSchool(schoolId: string): Promise<void> {
    await this.cache.delByPrefix(`perm:${schoolId}:`);
  }

  // ---- MFA flag and SoD ----------------------------------------------------------------------------

  async requiresMfa(code: string): Promise<boolean> {
    const key = `perm-mfa:${code}`;
    const cached = await this.cache.get<boolean>(key);
    if (cached !== null) return cached;
    const value = await this.db.global(async (c) => {
      const r = await c.query<{ requires_mfa: boolean }>(
        `SELECT requires_mfa FROM permissions WHERE code = $1`,
        [code],
      );
      return r.rows[0]?.requires_mfa ?? false;
    });
    await this.cache.set(key, value, PERM_TTL_SECONDS);
    return value;
  }

  /** Returns the conflicting permission if the user holds both sides of a SoD rule, else null. */
  async sodConflict(
    tenant: TenantContext,
    code: string,
    held: ReadonlySet<string>,
  ): Promise<string | null> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ other: string }>(
        `SELECT CASE WHEN permission_a = $1 THEN permission_b ELSE permission_a END AS other
           FROM sod_rules
          WHERE (permission_a = $1 OR permission_b = $1)
            AND (school_id IS NULL OR school_id = app.current_school_id())`,
        [code],
      );
      for (const row of r.rows) if (held.has(row.other)) return row.other;
      return null;
    });
  }

  /**
   * Grant-time check (ADR-004 point 5): would giving `roleId` to `userId` make them hold both sides of a
   * segregation-of-duties rule? Returns the first conflicting pair or null.
   */
  async sodConflictForGrant(
    tenant: TenantContext,
    userId: string,
    roleId: string,
  ): Promise<{ a: string; b: string } | null> {
    const held = await this.effectivePermissionsFor(tenant, userId);
    return this.db.tenant(tenant, async (c) => {
      const rolePerms = await c.query<{ code: string }>(
        `SELECT permission_code AS code FROM role_permissions WHERE role_id = $1`,
        [roleId],
      );
      const union = new Set(held);
      for (const p of rolePerms.rows) union.add(p.code);
      const rules = await c.query<{ permission_a: string; permission_b: string }>(
        `SELECT permission_a, permission_b FROM sod_rules WHERE school_id IS NULL OR school_id = app.current_school_id()`,
      );
      for (const rule of rules.rows) {
        if (union.has(rule.permission_a) && union.has(rule.permission_b))
          return { a: rule.permission_a, b: rule.permission_b };
      }
      return null;
    });
  }

  // ---- scopes ----------------------------------------------------------------------------------------

  /** Scope ids the user may act on; null = unrestricted (an assignment granting the permission has no scope rows). */
  async scopesFor(
    tenant: TenantContext,
    permission: string,
    scopeType: ScopeType,
  ): Promise<string[] | null> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ scopes: string[] | null }>(
        `SELECT (
                  SELECT array_agg(s.scope_id::text)
                    FROM user_role_scopes s
                   WHERE s.user_role_id = ur.id AND s.scope_type = $2::scope_type
                ) AS scopes
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.status = 'active' AND r.deleted_at IS NULL
           JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_code = $1
          WHERE ur.user_id = app.current_user_id()
            AND ur.revoked_at IS NULL
            AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
        [permission, scopeType],
      );
      if (r.rowCount === 0) return [];
      const union = new Set<string>();
      for (const row of r.rows) {
        if (row.scopes === null) return null;
        for (const id of row.scopes) union.add(id);
      }
      return [...union];
    });
  }

  // ---- catalogue -------------------------------------------------------------------------------------

  async listPermissions(): Promise<
    Array<{ code: string; module: string; description: string; requiresMfa: boolean }>
  > {
    return this.db.global(async (c) => {
      const r = await c.query<{
        code: string;
        module: string;
        description: string;
        requires_mfa: boolean;
      }>(
        `SELECT code, module, description, requires_mfa FROM permissions WHERE orphaned = false ORDER BY code`,
      );
      return r.rows.map((p) => ({
        code: p.code,
        module: p.module,
        description: p.description,
        requiresMfa: p.requires_mfa,
      }));
    });
  }
}
