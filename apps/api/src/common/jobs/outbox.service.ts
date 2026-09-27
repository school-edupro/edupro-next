import { Injectable } from '@nestjs/common';
import type { JobEnvelope, PoolClient, QueueName } from '@edupro/db';
import { requireTenant, type RequestContext } from '../http/request-context';

/**
 * Transactional outbox producer (S3-01, ADR-009). Services call enqueue() with the client of the
 * transaction that writes the business rows, so the job exists only if that transaction commits. The
 * worker-side publisher (apps/workers/src/outbox-publisher.ts) moves rows to BullMQ.
 */
@Injectable()
export class OutboxService {
  async enqueue<T>(
    client: PoolClient,
    ctx: RequestContext,
    queue: QueueName,
    kind: string,
    payload: T,
    availableAt?: Date,
  ): Promise<string> {
    const tenant = requireTenant(ctx);
    const envelope: JobEnvelope<T> = {
      schoolId: tenant.schoolId,
      userId: tenant.userId ?? null,
      requestId: ctx.requestId,
      kind,
      payload,
    };
    const r = await client.query<{ id: string }>(
      'SELECT app.enqueue_job($1, $2::jsonb, $3::timestamptz)::text AS id',
      [queue, JSON.stringify(envelope), availableAt ?? null],
    );
    return r.rows[0]!.id;
  }
}
