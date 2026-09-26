import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { Db, type TenantContext } from '@edupro/db';
import { QUEUES, type JobEnvelope, type QueueName } from './queues';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['payload.mobile', 'payload.email'] });

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const db = new Db({ connectionString: process.env.DATABASE_URL ?? '' });

/**
 * Every job runs with a tenant context (ADR-002): the envelope carries school_id and the worker sets it on
 * the transaction, so RLS applies to background work exactly as it does to API requests.
 */
function tenantFor(envelope: JobEnvelope): TenantContext {
  return {
    schoolId: envelope.schoolId,
    userId: null,
    allowedSchoolIds: [envelope.schoolId],
    requestId: envelope.requestId ?? null,
  };
}

const processors: Record<QueueName, (job: Job<JobEnvelope>) => Promise<void>> = {
  async notifications(job) {
    // Sprint 4: provider adapters (SMS DLT, WhatsApp, SMTP, FCM) and delivery log.
    log.info({ jobId: job.id, schoolId: job.data.schoolId }, 'notification job received (adapter pending)');
  },
  async exports(job) {
    // Sprint 4: Playwright PDF and exceljs generation, status endpoint, signed download URL.
    log.info({ jobId: job.id, schoolId: job.data.schoolId }, 'export job received (generator pending)');
  },
  async rfid(job) {
    // Sprint 9: device batches to attendance_sessions and attendance_marks via rules.
    await db.withTenant(tenantFor(job.data), async (c) => {
      await c.query('SELECT app.assert_context()');
    });
    log.info({ jobId: job.id, schoolId: job.data.schoolId }, 'rfid batch received (rules pending)');
  },
  async reconciliation(job) {
    log.info({ jobId: job.id, schoolId: job.data.schoolId }, 'reconciliation job received (Sprint 15)');
  },
  async maintenance(job) {
    // Partition management runs with the migrator connection in a dedicated maintenance job (ADR-005).
    log.info({ jobId: job.id }, 'maintenance job received');
  },
};

async function main(): Promise<void> {
  await db.assertApplicationRole();
  const workers = (Object.keys(processors) as QueueName[]).map(
    (name) =>
      new Worker<JobEnvelope>(QUEUES[name], processors[name], {
        connection,
        concurrency: name === 'exports' ? 2 : 10,
      })
        .on('failed', (job, error) => log.error({ queue: name, jobId: job?.id, err: error.message }, 'job failed'))
        .on('completed', (job) => log.debug({ queue: name, jobId: job.id }, 'job completed')),
  );
  log.info({ queues: Object.values(QUEUES) }, 'workers started');

  const shutdown = async () => {
    log.info('shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  log.fatal({ err: error }, 'workers failed to start');
  process.exit(1);
});
