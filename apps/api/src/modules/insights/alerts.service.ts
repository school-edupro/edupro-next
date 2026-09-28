import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

export interface InsightAlert {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'danger';
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  message: string;
  data: Record<string, unknown>;
  detectedOn: string;
  notifiedAt: string | null;
  ackedBy: string | null;
  ackedAt: string | null;
}

/** Sprint 15: anomaly alerts v1, written nightly by the workers job `insights.alerts`. */
@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, openOnly: boolean, days: number): Promise<InsightAlert[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT a.id::text, a.kind, a.severity, a.subject_type, a.subject_id::text, a.title, a.message, a.data, a.detected_on::text,
                a.notified_at, u.display_name AS acked_by, a.acked_at
           FROM insight_alerts a LEFT JOIN users u ON u.id = a.acked_by
          WHERE a.detected_on >= CURRENT_DATE - $1::int AND ($2::boolean = false OR a.acked_at IS NULL)
          ORDER BY a.acked_at IS NULL DESC, a.detected_on DESC, CASE a.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.id DESC
          LIMIT 300`,
        [days, openOnly],
      );
      return r.rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        severity: x.severity,
        subjectType: x.subject_type,
        subjectId: x.subject_id,
        title: x.title,
        message: x.message,
        data: x.data ?? {},
        detectedOn: x.detected_on,
        notifiedAt: x.notified_at ? (x.notified_at as Date).toISOString() : null,
        ackedBy: x.acked_by,
        ackedAt: x.acked_at ? (x.acked_at as Date).toISOString() : null,
      }));
    });
  }

  async ack(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; kind: string }>(
        `UPDATE insight_alerts SET acked_by = app.current_user_id(), acked_at = now() WHERE id = $1 AND acked_at IS NULL RETURNING id::text, kind`,
        [id],
      );
      if (!r.rows[0])
        throw new DomainError('not-found', 'Alert not found or already acknowledged', {
          status: 404,
        });
      await this.audit.stage(ctx, c, {
        action: 'insights.alert.ack',
        entityType: 'insight_alerts',
        entityId: id,
        after: { kind: r.rows[0].kind },
      });
      return { ok: true };
    });
  }
}
