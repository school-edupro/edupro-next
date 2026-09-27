import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuditQueryDto } from './platform.dto';

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorUserId: string | null;
  actorName: string | null;
  impersonatedBy: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  diff: Record<string, unknown> | null;
  before?: unknown;
  after?: unknown;
  permissionCode: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent?: string | null;
  source: string;
}

interface AuditDbRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  impersonated_by: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: Record<string, unknown> | null;
  before?: unknown;
  after?: unknown;
  permission_code: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent?: string | null;
  source: string;
}

const LIST_COLS = `a.id::text, a.occurred_at, a.actor_type::text, a.actor_user_id::text, u.display_name AS actor_name, a.impersonated_by::text,
  a.action, a.entity_type, a.entity_id, a.diff, a.permission_code, a.request_id::text, a.ip::text, a.source::text`;

const toRow = (x: AuditDbRow): AuditRow => ({
  id: x.id,
  occurredAt: x.occurred_at.toISOString(),
  actorType: x.actor_type,
  actorUserId: x.actor_user_id,
  actorName: x.actor_name,
  impersonatedBy: x.impersonated_by,
  action: x.action,
  entityType: x.entity_type,
  entityId: x.entity_id,
  diff: x.diff,
  ...(x.before !== undefined ? { before: x.before } : {}),
  ...(x.after !== undefined ? { after: x.after } : {}),
  permissionCode: x.permission_code,
  requestId: x.request_id,
  ip: x.ip,
  ...(x.user_agent !== undefined ? { userAgent: x.user_agent } : {}),
  source: x.source,
});

/** Read side of the audit log (S3-04). Rows are append-only; this service never writes. */
@Injectable()
export class AuditQueryService {
  constructor(private readonly db: DbService) {}

  list(tenant: TenantContext, q: AuditQueryDto): Promise<{ rows: AuditRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE ($1::timestamptz IS NULL OR a.occurred_at >= $1::timestamptz)' +
        ' AND ($2::timestamptz IS NULL OR a.occurred_at < $2::timestamptz)' +
        ' AND ($3::text IS NULL OR a.entity_type = $3::text)' +
        ' AND ($4::text IS NULL OR a.entity_id = $4::text)' +
        ' AND ($5::bigint IS NULL OR a.actor_user_id = $5::bigint)' +
        " AND ($6::text IS NULL OR a.action LIKE $6::text || '%')" +
        ' AND ($7::uuid IS NULL OR a.request_id = $7::uuid)';
      const params: unknown[] = [
        q.from ?? null,
        q.to ?? null,
        q.entityType ?? null,
        q.entityId ?? null,
        q.actorUserId ?? null,
        q.action ?? null,
        q.requestId ?? null,
      ];
      const total = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM audit_logs a' + where,
        params,
      );
      const r = await c.query<AuditDbRow>(
        'SELECT ' +
          LIST_COLS +
          ' FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id' +
          where +
          ' ORDER BY a.occurred_at DESC, a.id DESC LIMIT $8 OFFSET $9',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  get(tenant: TenantContext, id: string): Promise<AuditRow> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<AuditDbRow>(
        'SELECT ' +
          LIST_COLS +
          ', a.before, a.after, a.user_agent FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.id = $1',
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Audit entry not found');
      return toRow(r.rows[0]);
    });
  }
}
