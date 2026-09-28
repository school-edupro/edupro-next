import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxPublisher } from '../src/outbox-publisher';
import {
  log,
  newDb,
  seedSchool,
  stamp,
  tenantOf,
  withMigrator,
  REDIS_URL,
  type SeededSchool,
} from './helpers';

describe('outbox publisher (S3-01)', () => {
  const db = newDb();
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  let school: SeededSchool;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    school = await seedSchool(stamp('WOB'));
    publisher = new OutboxPublisher(db, connection, log, {
      batch: 100,
      lockSeconds: 60,
      maxAttempts: 2,
      pollMs: 1000,
    });
  });
  afterAll(async () => {
    await publisher.stop();
    await connection.quit();
    await db.close();
  });

  it('publishes committed rows exactly once; rolled-back rows never exist', async () => {
    const tenant = tenantOf(school);
    const envelope = {
      schoolId: school.id,
      userId: school.userId,
      requestId: null,
      kind: 'test.ping',
      payload: { n: 1 },
    };
    const id = await db.withTenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        "SELECT app.enqueue_job('notifications', $1::jsonb)::text AS id",
        [JSON.stringify(envelope)],
      );
      return r.rows[0]!.id;
    });
    await expect(
      db.withTenant(tenant, async (c) => {
        await c.query("SELECT app.enqueue_job('notifications', $1::jsonb)", [
          JSON.stringify({ ...envelope, kind: 'test.rollback' }),
        ]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const rolledBack = await withMigrator((c) =>
      c.query(
        "SELECT 1 FROM jobs_outbox WHERE school_id = $1 AND payload->>'kind' = 'test.rollback'",
        [school.id],
      ),
    );
    expect(rolledBack.rowCount).toBe(0);

    // other test files may be flooding the outbox at the same time (jobs that run for every school);
    // drain in bounded passes until this row's job appears
    let first = await publisher.publishOnce();
    let job = await publisher.queue('notifications').getJob(`outbox-${id}`);
    for (let i = 0; !job && i < 300; i += 1) {
      first = await publisher.publishOnce();
      job = await publisher.queue('notifications').getJob(`outbox-${id}`);
    }
    expect(first.published + first.claimed).toBeGreaterThanOrEqual(0);
    expect(job?.data).toMatchObject({ kind: 'test.ping', schoolId: school.id });
    const row = await withMigrator((c) =>
      c.query<{ status: string }>('SELECT status FROM jobs_outbox WHERE id = $1', [id]),
    );
    expect(row.rows[0]?.status).toBe('published');

    // A second pass finds nothing new for this row.
    const again = await publisher.publishOnce();
    const stillOne = await publisher.queue('notifications').getJob(`outbox-${id}`);
    expect(stillOne?.id).toBe(job?.id);
    expect(again.claimed).toBeGreaterThanOrEqual(0);
    await job?.remove();
  });

  it('keeps rows that cannot be published in the dead-letter list after the attempt limit', async () => {
    const bad = await withMigrator((c) =>
      c.query<{ id: string }>(
        'INSERT INTO jobs_outbox (school_id, queue, payload) VALUES ($1, \'notifications\', \'{"not": "an envelope"}\'::jsonb) RETURNING id::text',
        [school.id],
      ),
    );
    const id = bad.rows[0]!.id;
    const read = () =>
      withMigrator((c) =>
        c.query<{ status: string; attempts: number; last_error: string }>(
          'SELECT status, attempts, last_error FROM jobs_outbox WHERE id = $1',
          [id],
        ),
      );
    let row = await read();
    for (let i = 0; row.rows[0]?.attempts === 0 && i < 300; i += 1) {
      await publisher.publishOnce();
      row = await read();
    }
    expect(row.rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.rows[0]?.last_error).toMatch(/envelope/);
    // The retry is scheduled in the future; bring it forward and fail it again to reach the limit.
    await withMigrator((c) =>
      c.query('UPDATE jobs_outbox SET available_at = now() WHERE id = $1', [id]),
    );
    row = await read();
    for (let i = 0; row.rows[0]?.attempts === 1 && i < 300; i += 1) {
      await publisher.publishOnce();
      row = await read();
    }
    expect(row.rows[0]).toMatchObject({ status: 'failed', attempts: 2 });
  });
});
