import { Queue, type JobsOptions } from 'bullmq';
import type IORedis from 'ioredis';
import { isJobEnvelope, type Db } from '@edupro/db';
import type { Logger } from './logger';

interface OutboxRow {
  id: string;
  school_id: string;
  queue: string;
  payload: unknown;
  attempts: number;
}

export interface PublisherOptions {
  batch: number;
  lockSeconds: number;
  maxAttempts: number;
  pollMs: number;
}

const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 1_000, age: 24 * 3600 },
  removeOnFail: { count: 5_000 },
};

/**
 * Moves committed outbox rows to BullMQ (S3-01, ADR-009). A row is leased with app.claim_outbox_batch,
 * added with a deterministic job id (so a crash between add and complete cannot enqueue it twice), then
 * marked published. Rows whose add keeps failing land in the dead-letter list (status = failed).
 */
export class OutboxPublisher {
  private readonly queues = new Map<string, Queue>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly connection: IORedis,
    private readonly log: Logger,
    private readonly opts: PublisherOptions,
  ) {}

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  async publishOnce(): Promise<{ claimed: number; published: number; failed: number }> {
    const claimed = await this.db.withoutTenant((c) =>
      c.query<OutboxRow>(
        'SELECT id::text, school_id::text, queue, payload, attempts FROM app.claim_outbox_batch($1, $2)',
        [this.opts.batch, this.opts.lockSeconds],
      ),
    );
    const done: string[] = [];
    let failed = 0;
    for (const row of claimed.rows) {
      try {
        if (!isJobEnvelope(row.payload)) throw new Error('payload is not a job envelope');
        if (row.payload.schoolId !== row.school_id)
          throw new Error('envelope school does not match the outbox row');
        await this.queue(row.queue).add(row.payload.kind, row.payload, {
          ...JOB_OPTIONS,
          jobId: `outbox-${row.id}`,
        });
        done.push(row.id);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const status = await this.db.withoutTenant((c) =>
          c.query<{ status: string }>('SELECT app.fail_outbox($1, $2, $3, $4)::text AS status', [
            row.id,
            message,
            30,
            this.opts.maxAttempts,
          ]),
        );
        this.log.error(
          { outboxId: row.id, queue: row.queue, status: status.rows[0]?.status, err: message },
          'outbox publish failed',
        );
      }
    }
    if (done.length > 0) {
      await this.db.withoutTenant((c) =>
        c.query('SELECT app.complete_outbox($1::bigint[])', [done]),
      );
    }
    return { claimed: claimed.rows.length, published: done.length, failed };
  }

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        let result = await this.publishOnce();
        // Drain quickly when there is a backlog; otherwise wait for the next poll.
        while (result.claimed >= this.opts.batch) result = await this.publishOnce();
      } catch (error) {
        this.log.error(
          { err: error instanceof Error ? error.message : String(error) },
          'outbox poll failed',
        );
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.opts.pollMs);
    void tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
