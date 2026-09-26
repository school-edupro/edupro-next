import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { AuditSnapshot, RequestContext } from '../http/request-context';

/**
 * Service-level audit writer (ADR-005). Money and marks tables are additionally covered by database
 * triggers; this records every other mutation and all privileged actions with request metadata.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(ctx: RequestContext, snapshot: AuditSnapshot, permissionCode?: string): Promise<void> {
    const tenant = ctx.tenant;
    if (!tenant) return; // nothing tenant-scoped to record; identity events go to login_events

    const before = snapshot.before === undefined ? null : JSON.stringify(snapshot.before);
    const after = snapshot.after === undefined ? null : JSON.stringify(snapshot.after);
    const diff = diffRecords(snapshot.before, snapshot.after);

    await this.db.tenant(tenant, async (c) => {
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
    });
  }
}

/** Changed top-level fields only: { field: { from, to } }. Null when either side is not a plain object. */
export function diffRecords(before: unknown, after: unknown): Record<string, { from: unknown; to: unknown }> | null {
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
