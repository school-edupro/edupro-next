import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { CacheService } from '../../common/cache/cache.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { OutboxQueryDto } from './platform.dto';

export interface OutboxRow {
  id: string;
  queue: string;
  kind: string | null;
  status: 'pending' | 'published' | 'failed';
  attempts: number;
  lastError: string | null;
  availableAt: string;
  createdAt: string;
  publishedAt: string | null;
  requestId: string | null;
}

interface OutboxDbRow {
  id: string;
  queue: string;
  kind: string | null;
  status: OutboxRow['status'];
  attempts: number;
  last_error: string | null;
  available_at: Date;
  created_at: Date;
  published_at: Date | null;
  request_id: string | null;
}

const SELECT =
  "SELECT id::text, queue, payload->>'kind' AS kind, status, attempts, last_error, available_at, created_at, published_at, request_id::text FROM jobs_outbox";

const toRow = (x: OutboxDbRow): OutboxRow => ({
  id: x.id,
  queue: x.queue,
  kind: x.kind,
  status: x.status,
  attempts: x.attempts,
  lastError: x.last_error,
  availableAt: x.available_at.toISOString(),
  createdAt: x.created_at.toISOString(),
  publishedAt: x.published_at ? x.published_at.toISOString() : null,
  requestId: x.request_id,
});

/** Dead-letter visibility for the school's own jobs (S3-01). Payloads are never returned: they may carry PII. */
@Injectable()
export class JobsService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The worker processes and what waits for them: each process reports itself every 20 seconds (a
   * report older than 90 seconds means it has stopped), with the jobs of each queue; and this school's
   * messages, exports and outbox jobs that are waiting or failed.
   */
  async workers(tenant: TenantContext) {
    const raw = await this.cache.hashAll('edupro:workers');
    const now = Date.now();
    const all = Object.values(raw)
      .map((v) => {
        try {
          return JSON.parse(v) as { id: string; at: string } & Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((x): x is { id: string; at: string } & Record<string, unknown> => !!x);
    // a process that has not reported for a day is forgotten
    const gone = all.filter((p) => now - Date.parse(p.at) > 24 * 3600 * 1000).map((p) => p.id);
    await this.cache.hashDel('edupro:workers', gone);
    const processes = all
      .filter((p) => !gone.includes(p.id))
      .map((p) => ({ ...p, alive: now - Date.parse(p.at) <= 90_000 }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const school = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<Record<string, string | null>>(
        `SELECT
           (SELECT count(*) FROM comms_messages WHERE status = 'queued')::text AS "messagesQueued",
           (SELECT min(created_at) FROM comms_messages WHERE status = 'queued')::text AS "oldestQueued",
           (SELECT count(*) FROM comms_messages WHERE status = 'failed' AND failed_at >= CURRENT_DATE)::text AS "messagesFailedToday",
           (SELECT count(*) FROM comms_messages WHERE status IN ('sent', 'delivered') AND sent_at >= CURRENT_DATE)::text AS "messagesSentToday",
           (SELECT count(*) FROM exports WHERE status IN ('queued', 'running'))::text AS "exportsWaiting",
           (SELECT count(*) FROM jobs_outbox WHERE status = 'pending')::text AS "outboxPending",
           (SELECT count(*) FROM jobs_outbox WHERE status = 'failed')::text AS "outboxFailed"`,
      );
      return r.rows[0]!;
    });
    return {
      redis: this.cache.healthy,
      running: processes.some((p) => p.alive),
      processes,
      school,
    };
  }

  list(tenant: TenantContext, q: OutboxQueryDto): Promise<{ rows: OutboxRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE ($1::outbox_status IS NULL OR status = $1::outbox_status) AND ($2::text IS NULL OR queue = $2::text)';
      const params: unknown[] = [q.status ?? null, q.queue ?? null];
      const total = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM jobs_outbox' + where,
        params,
      );
      const r = await c.query<OutboxDbRow>(
        SELECT + where + ' ORDER BY created_at DESC LIMIT $3 OFFSET $4',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  retry(tenant: TenantContext, id: string): Promise<OutboxRow> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<OutboxDbRow>(
        "UPDATE jobs_outbox SET status = 'pending', attempts = 0, available_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1 AND status = 'failed' RETURNING id::text, queue, payload->>'kind' AS kind, status, attempts, last_error, available_at, created_at, published_at, request_id::text",
        [id],
      );
      if (!r.rows[0])
        throw new DomainError('job.not_failed', 'Only failed jobs can be retried', { status: 409 });
      return toRow(r.rows[0]);
    });
  }
}
