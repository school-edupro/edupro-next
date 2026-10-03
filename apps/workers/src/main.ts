import { startTracing } from './tracing';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { Db, QUEUES, type JobEnvelope } from '@edupro/db';
import { createStorageDriver } from '@edupro/storage';
import { buildAdapters } from './adapters';
import { loadEnv, storageConfigFrom } from './env';
import { createLogger } from './logger';
import { OutboxPublisher } from './outbox-publisher';
import { exportProcessor } from './processors/exports';
import { SYSTEM_ENVELOPE, maintenanceProcessor } from './processors/maintenance';
import { notificationProcessor } from './processors/notifications';
import { NoPdfEngine, PlaywrightPdfEngine } from './processors/pdf';

/**
 * Worker process (S3-01 to S3-03): publishes the transactional outbox to BullMQ and consumes the queues.
 * Every job runs under the tenant context carried in its envelope, so row-level security applies to
 * background work exactly as it does to API requests (ADR-002, ADR-009).
 */
async function main(): Promise<void> {
  await startTracing('edupro-workers');
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const db = new Db({ connectionString: env.DATABASE_URL });
  await db.assertApplicationRole();

  const storage = createStorageDriver(storageConfigFrom(env));
  const adapters = buildAdapters(env, log);
  const pdf =
    env.EXPORT_PDF_ENGINE === 'playwright' ? new PlaywrightPdfEngine() : new NoPdfEngine();

  const publisher = new OutboxPublisher(db, connection, log, {
    batch: env.OUTBOX_BATCH,
    lockSeconds: 60,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    pollMs: env.OUTBOX_POLL_MS,
  });
  publisher.start();

  type Processor = (job: Job<JobEnvelope<never>>) => Promise<void>;
  const processors: Record<string, Processor> = {
    [QUEUES.notifications]: notificationProcessor(
      db,
      adapters,
      log,
      storage,
    ) as unknown as Processor,
    [QUEUES.exports]: exportProcessor({
      db,
      storage,
      pdf,
      log,
      ttlDays: env.EXPORTS_TTL_DAYS,
    }) as unknown as Processor,
    [QUEUES.maintenance]: maintenanceProcessor({
      db,
      storage,
      log,
      migratorUrl: env.DATABASE_MIGRATOR_URL,
    }) as unknown as Processor,
    async [QUEUES.rfid](job) {
      // Sprint 9: device batches to attendance_sessions and attendance_marks via rules.
      log.info(
        { jobId: job.id, schoolId: job.data.schoolId },
        'rfid batch received (rules pending)',
      );
    },
    // Sprint 16: the reconciliation queue carries the shadow-run job (dispatched by kind like maintenance)
    [QUEUES.reconciliation]: maintenanceProcessor({
      db,
      storage,
      log,
      migratorUrl: env.DATABASE_MIGRATOR_URL,
    }) as unknown as Processor,
  };

  const workers = Object.entries(processors).map(([name, processor]) =>
    new Worker<JobEnvelope<never>>(name, processor, {
      connection,
      concurrency: name === QUEUES.exports ? 2 : 10,
    })
      .on('failed', (job, error) =>
        log.error(
          { queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: error.message },
          'job failed',
        ),
      )
      .on('completed', (job) => log.debug({ queue: name, jobId: job.id }, 'job completed')),
  );

  // Scheduled housekeeping: expire export files hourly, keep audit partitions ahead daily.
  const maintenance = new Queue(QUEUES.maintenance, { connection });
  await maintenance.upsertJobScheduler(
    'exports.expire',
    { every: 60 * 60 * 1000 },
    { name: 'exports.expire', data: SYSTEM_ENVELOPE('exports.expire') },
  );
  await maintenance.upsertJobScheduler(
    'audit.partitions',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'audit.partitions', data: SYSTEM_ENVELOPE('audit.partitions') },
  );
  await maintenance.upsertJobScheduler(
    'insights.refresh',
    { every: 15 * 60 * 1000 },
    { name: 'insights.refresh', data: SYSTEM_ENVELOPE('insights.refresh') },
  );
  await maintenance.upsertJobScheduler(
    'payments.reconcile',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'payments.reconcile', data: SYSTEM_ENVELOPE('payments.reconcile') },
  );
  const reconciliation = new Queue(QUEUES.reconciliation, { connection });
  await reconciliation.upsertJobScheduler(
    'shadow.reconcile',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'shadow.reconcile', data: SYSTEM_ENVELOPE('shadow.reconcile') },
  );
  // Mondays 06:00 IST (00:30 UTC): the previous week's brief and department weeklies
  await maintenance.upsertJobScheduler(
    'insights.reports',
    { pattern: '30 0 * * 1' },
    { name: 'insights.reports', data: SYSTEM_ENVELOPE('insights.reports') },
  );
  await maintenance.upsertJobScheduler(
    'insights.alerts',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'insights.alerts', data: SYSTEM_ENVELOPE('insights.alerts') },
  );
  await maintenance.upsertJobScheduler(
    'workflow.sla',
    { every: 60 * 60 * 1000 },
    { name: 'workflow.sla', data: SYSTEM_ENVELOPE('workflow.sla') },
  );
  await maintenance.upsertJobScheduler(
    'transport.positions.expire',
    { every: 24 * 60 * 60 * 1000 },
    { name: 'transport.positions.expire', data: SYSTEM_ENVELOPE('transport.positions.expire') },
  );
  await maintenance.upsertJobScheduler(
    'insights.results_mart',
    { every: 60 * 60 * 1000 },
    { name: 'insights.results_mart', data: SYSTEM_ENVELOPE('insights.results_mart') },
  );
  // first day of the month, 02:00 IST (20:30 UTC the day before)
  await maintenance.upsertJobScheduler(
    'archive.closed_years',
    { pattern: '30 20 * * *' },
    { name: 'archive.closed_years', data: SYSTEM_ENVELOPE('archive.closed_years') },
  );
  await maintenance.upsertJobScheduler(
    'reports.scheduled',
    { every: 60 * 60 * 1000 },
    { name: 'reports.scheduled', data: SYSTEM_ENVELOPE('reports.scheduled') },
  );
  // 08:30 IST (03:00 UTC) every day during hypercare
  await maintenance.upsertJobScheduler(
    'hypercare.digest',
    { pattern: '0 3 * * *' },
    { name: 'hypercare.digest', data: SYSTEM_ENVELOPE('hypercare.digest') },
  );
  // nightly 03:00 IST (21:30 UTC)
  await maintenance.upsertJobScheduler(
    'retention.purge',
    { pattern: '30 21 * * *' },
    { name: 'retention.purge', data: SYSTEM_ENVELOPE('retention.purge') },
  );
  // helpdesk: escalate tickets past their SLA every five minutes
  await maintenance.upsertJobScheduler(
    'helpdesk.escalate',
    { every: 5 * 60 * 1000 },
    { name: 'helpdesk.escalate', data: SYSTEM_ENVELOPE('helpdesk.escalate') },
  );
  // appointments: reminders, no-shows and wiping expired one-time codes, every five minutes
  await maintenance.upsertJobScheduler(
    'appointments.tick',
    { every: 5 * 60 * 1000 },
    { name: 'appointments.tick', data: SYSTEM_ENVELOPE('appointments.tick') },
  );
  await maintenance.upsertJobScheduler(
    'break_glass.expire',
    { every: 5 * 60 * 1000 },
    { name: 'break_glass.expire', data: SYSTEM_ENVELOPE('break_glass.expire') },
  );

  log.info(
    { queues: Object.keys(processors), storage: storage.name, pdf: env.EXPORT_PDF_ENGINE },
    'workers started',
  );

  const shutdown = async () => {
    log.info('shutting down');
    await publisher.stop();
    await Promise.all(workers.map((w) => w.close()));
    await maintenance.close();
    await pdf.close();
    await connection.quit();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('workers failed to start', error);
  process.exit(1);
});
