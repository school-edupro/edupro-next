import { Injectable } from '@nestjs/common';
import { maskSensitive, type PoolClient, type TenantContext } from '@edupro/db';
import { DbService } from '../db/db.service';
import type { AuditSnapshot, RequestContext } from '../http/request-context';

/**
 * Service-level audit writer (ADR-005). Money and marks tables are additionally covered by database
 * triggers; this records every other mutation and all privileged actions with request metadata.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /**
   * Writes the audit row inside the caller's open transaction (S3-04): the row commits with the change
   * or not at all, so a crash after commit cannot lose it. Marks the request so the interceptor skips
   * its post-commit write.
   */
  async stage(ctx: RequestContext, client: PoolClient, snapshot: AuditSnapshot): Promise<void> {
    const tenant = ctx.tenant;
    if (!tenant) return;
    await this.insert(client, ctx, tenant, snapshot, ctx.requiredPermission);
    ctx.auditWritten = true;
  }

  /** Post-commit write used by AuditInterceptor for services that do not stage. */
  async record(
    ctx: RequestContext,
    snapshot: AuditSnapshot,
    permissionCode?: string,
  ): Promise<void> {
    const tenant = ctx.tenant;
    if (!tenant) return; // nothing tenant-scoped to record; identity events go to login_events
    await this.db.tenant(tenant, (c) => this.insert(c, ctx, tenant, snapshot, permissionCode));
  }

  private async insert(
    client: PoolClient,
    ctx: RequestContext,
    tenant: TenantContext,
    snapshot: AuditSnapshot,
    permissionCode: string | undefined,
  ): Promise<void> {
    // Sensitive fields are masked in audit images (logging standard section 3); personal fields stay.
    const maskedBefore =
      snapshot.before === undefined
        ? undefined
        : maskSensitive(snapshot.before, snapshot.entityType);
    const maskedAfter =
      snapshot.after === undefined ? undefined : maskSensitive(snapshot.after, snapshot.entityType);
    const before = maskedBefore === undefined ? null : JSON.stringify(maskedBefore);
    const after = maskedAfter === undefined ? null : JSON.stringify(maskedAfter);
    const diff = diffRecords(maskedBefore, maskedAfter);

    {
      const c = client;
      await c.query(
        `INSERT INTO audit_logs
           (school_id, actor_type, actor_user_id, impersonated_by, action, entity_type, entity_id,
            before, after, diff, permission_code, request_id, ip, user_agent, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::uuid, $13::inet, $14, 'api')`,
        [
          tenant.schoolId,
          tenant.impersonatedBy ? 'impersonated_user' : 'user',
          tenant.userId ?? null,
          tenant.impersonatedBy ?? null,
          snapshot.action,
          snapshot.entityType,
          snapshot.entityId ?? null,
          before,
          after,
          diff === null ? null : JSON.stringify(diff),
          permissionCode ?? null,
          ctx.requestId,
          ctx.ip ?? null,
          ctx.userAgent ?? null,
        ],
      );
    }
  }
}

/** Changed top-level fields only: { field: { from, to } }. Null when either side is not a plain object. */
export function diffRecords(
  before: unknown,
  after: unknown,
): Record<string, { from: unknown; to: unknown }> | null {
  if (!isRecord(before) || !isRecord(after)) return null;
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from, to };
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
