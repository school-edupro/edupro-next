import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { PermissionRegistry } from '../../common/access/permission-registry';
import { DbService } from '../../common/db/db.service';

export type ScopeType = 'class_section' | 'subject' | 'department' | 'route' | 'campus';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Effective permissions, scopes, segregation of duties and catalogue synchronisation (ADR-004).
 * The in-process cache is a placeholder for the Redis cache planned in Sprint 3; both use the same keys so
 * the swap is local to this file.
 */
@Injectable()
export class AccessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessService.name);
  private readonly permissionCache = new Map<string, CacheEntry<ReadonlySet<string>>>();
  private readonly mfaCache = new Map<string, CacheEntry<boolean>>();
  private readonly ttlMs = 5 * 60 * 1000;

  constructor(private readonly db: DbService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncCatalogue();
  }

  /** Upserts every permission declared in code into the permissions table; flags database-only rows. */
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
      // Only codes that code once declared can become orphaned; seeded permissions awaiting their module are untouched.
      const orphaned = await c.query<{ code: string }>(
        `UPDATE permissions SET orphaned = true, updated_at = now()
         WHERE declared_in_code = true AND code <> ALL($1::text[]) AND orphaned = false RETURNING code`,
        [declared.map((p) => p.code)],
      );
      if ((orphaned.rowCount ?? 0) > 0) {
        this.logger.warn(`permissions in database but not in code: ${orphaned.rows.map((r) => r.code).join(', ')}`);
      }
    });
    this.logger.log(`permission catalogue synchronised (${declared.length} codes)`);
  }

  private cacheKey(tenant: TenantContext): string {
    return `perm:${tenant.schoolId}:${tenant.userId ?? 'anon'}`;
  }

  /** Union of permissions from active role assignments and active delegations for (user, school). */
  async effectivePermissions(tenant: TenantContext): Promise<ReadonlySet<string>> {
    const key = this.cacheKey(tenant);
    const hit = this.permissionCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const codes = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ code: string }>(
        `SELECT DISTINCT rp.permission_code AS code
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.status = 'active' AND r.deleted_at IS NULL
           JOIN role_permissions rp ON rp.role_id = ur.role_id
          WHERE ur.user_id = app.current_user_id()
            AND ur.revoked_at IS NULL
            AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
         UNION
         SELECT DISTINCT rp.permission_code
           FROM delegations d
           JOIN role_permissions rp ON rp.role_id = d.role_id
          WHERE d.to_user_id = app.current_user_id()
            AND d.revoked_at IS NULL
            AND now() BETWEEN d.starts_at AND d.ends_at`,
      );
      return r.rows.map((x) => x.code);
    });

    const value: ReadonlySet<string> = new Set(codes);
    this.permissionCache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(tenant: TenantContext): void {
    this.permissionCache.delete(this.cacheKey(tenant));
  }

  async requiresMfa(code: string): Promise<boolean> {
    const hit = this.mfaCache.get(code);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.db.global(async (c) => {
      const r = await c.query<{ requires_mfa: boolean }>(`SELECT requires_mfa FROM permissions WHERE code = $1`, [code]);
      return r.rows[0]?.requires_mfa ?? false;
    });
    this.mfaCache.set(code, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Returns the conflicting permission if the user holds both sides of a SoD rule, else null. */
  async sodConflict(tenant: TenantContext, code: string, held: ReadonlySet<string>): Promise<string | null> {
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
   * Scope ids the user may act on for a permission and scope type. null = unrestricted (at least one
   * granting assignment has no scope rows of that type).
   */
  async scopesFor(tenant: TenantContext, permission: string, scopeType: ScopeType): Promise<string[] | null> {
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
        if (row.scopes === null) return null; // an unscoped assignment grants everything
        for (const id of row.scopes) union.add(id);
      }
      return [...union];
    });
  }

  async listPermissions(): Promise<Array<{ code: string; module: string; description: string; requiresMfa: boolean }>> {
    return this.db.global(async (c) => {
      const r = await c.query<{ code: string; module: string; description: string; requires_mfa: boolean }>(
        `SELECT code, module, description, requires_mfa FROM permissions WHERE orphaned = false ORDER BY code`,
      );
      return r.rows.map((p) => ({ code: p.code, module: p.module, description: p.description, requiresMfa: p.requires_mfa }));
    });
  }

  async listRoles(tenant: TenantContext) {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        kind: string;
        is_system: boolean;
        school_id: string | null;
        permissions: string[];
      }>(
        `SELECT r.id::text, r.code, r.name, r.kind, r.is_system, r.school_id::text,
                COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
           FROM roles r
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
          WHERE r.deleted_at IS NULL
          GROUP BY r.id
          ORDER BY r.is_system DESC, r.name`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        code: x.code,
        name: x.name,
        kind: x.kind,
        isSystem: x.is_system,
        schoolId: x.school_id,
        permissions: x.permissions,
      }));
    });
  }
}
