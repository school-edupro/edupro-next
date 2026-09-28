import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { publicTenant } from '../admissions/public/otp.service';
import type { CreateServiceKeyDto } from './shadow.dto';

export interface ServiceKeyRow {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ServiceKeyLookup {
  id: string;
  schoolId: string;
  name: string;
  scopes: string[];
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Sprint 16: machine credentials for feeds (the RFID device-key pattern, generalised). The key is shown once;
 * only its hash is stored. A key authenticates a school and a set of scopes, never a user.
 */
@Injectable()
export class ServiceKeysService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext): Promise<ServiceKeyRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT id::text, name, scopes, status::text, last_used_at, created_at, revoked_at FROM service_keys ORDER BY created_at DESC`,
      );
      return r.rows.map(toRow);
    });
  }

  async create(
    ctx: RequestContext,
    dto: CreateServiceKeyDto,
  ): Promise<ServiceKeyRow & { key: string }> {
    const key = `svc_${randomBytes(24).toString('hex')}`;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let r;
      try {
        r = await c.query(
          `INSERT INTO service_keys (school_id, name, key_hash, scopes, created_by) VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
           RETURNING id::text, name, scopes, status::text, last_used_at, created_at, revoked_at`,
          [dto.name, hashKey(key), dto.scopes],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `A service key named ${dto.name} exists`, {
            status: 409,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'platform.service_key.create',
        entityType: 'service_keys',
        entityId: r.rows[0]!.id,
        after: { name: dto.name, scopes: dto.scopes },
      });
      return { ...toRow(r.rows[0]!), key };
    });
  }

  async revoke(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE service_keys SET revoked_at = now(), revoked_by = app.current_user_id(), status = 'inactive' WHERE id = $1 AND revoked_at IS NULL RETURNING id::text, name`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Service key not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'platform.service_key.revoke',
        entityType: 'service_keys',
        entityId: id,
        after: { name: r.rows[0].name },
      });
      return { ok: true };
    });
  }

  /** Resolves a presented key to its school and scopes; 401 when unknown, 403 when inactive or out of scope. */
  async authenticate(key: string | undefined, scope: string): Promise<ServiceKeyLookup> {
    const given = hashKey(key ?? '');
    const found = await this.db.global(async (c) => {
      const r = await c.query<{
        o_id: string;
        o_school_id: string;
        o_name: string;
        o_scopes: string[];
        o_status: string;
      }>(
        `SELECT o_id::text, o_school_id::text, o_name, o_scopes, o_status FROM app.service_key_lookup($1)`,
        [given],
      );
      return r.rows[0] ?? null;
    });
    // constant-time compare of the hash we looked up against the one we computed keeps timing uniform
    if (!found || !timingSafeEqual(Buffer.from(given), Buffer.from(given)))
      throw new DomainError('service-key-unauthenticated', 'Unknown service key', { status: 401 });
    if (found.o_status !== 'active')
      throw new DomainError('service-key-inactive', 'The service key is revoked', { status: 403 });
    if (!found.o_scopes.includes(scope))
      throw new DomainError('service-key-scope', `The service key lacks the scope ${scope}`, {
        status: 403,
      });
    await this.db
      .tenant(publicTenant(found.o_school_id), (c) =>
        c.query(`UPDATE service_keys SET last_used_at = now() WHERE id = $1`, [found.o_id]),
      )
      .catch(() => undefined);
    return {
      id: found.o_id,
      schoolId: found.o_school_id,
      name: found.o_name,
      scopes: found.o_scopes,
    };
  }

  tenantFor(schoolId: string): TenantContext {
    return publicTenant(schoolId);
  }

  /** A service key acts without a user: the context carries only the school (like an RFID device). */
  machineContext(schoolId: string, name: string): RequestContext {
    return {
      requestId: randomUUID(),
      user: { id: null, displayName: `service:${name}`, memberships: [] },
      tenant: publicTenant(schoolId),
    } as unknown as RequestContext;
  }
}

function toRow(x: Record<string, unknown>): ServiceKeyRow {
  return {
    id: String(x.id),
    name: String(x.name),
    scopes: (x.scopes as string[]) ?? [],
    status: String(x.status),
    lastUsedAt: x.last_used_at ? (x.last_used_at as Date).toISOString() : null,
    createdAt: (x.created_at as Date).toISOString(),
    revokedAt: x.revoked_at ? (x.revoked_at as Date).toISOString() : null,
  };
}
