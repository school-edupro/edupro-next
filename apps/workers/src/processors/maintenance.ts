import { Client } from 'pg';
import type { Db, JobEnvelope } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import type { Logger } from '../logger';
import type { JobLike } from './notifications';

export interface MaintenanceDeps {
  db: Db;
  storage: StorageDriver;
  log: Logger;
  migratorUrl: string | undefined;
}

/** Cross-tenant housekeeping. Jobs here carry a system envelope (schoolId "0") and use SECURITY DEFINER routines. */
export function maintenanceProcessor({ db, storage, log, migratorUrl }: MaintenanceDeps) {
  return async (job: JobLike<unknown>): Promise<void> => {
    const kind = (job.data as JobEnvelope).kind;
    if (kind === 'exports.expire') {
      const expired = await db.withoutTenant((c) =>
        c.query<{
          o_export_id: string;
          o_school_id: string;
          o_file_id: string | null;
          o_bucket: string | null;
          o_object_key: string | null;
        }>(
          'SELECT o_export_id::text, o_school_id::text, o_file_id::text, o_bucket, o_object_key FROM app.expire_exports($1)',
          [200],
        ),
      );
      for (const row of expired.rows) {
        if (row.o_object_key) {
          await storage.remove(row.o_object_key).catch((error: unknown) =>
            log.warn(
              {
                exportId: row.o_export_id,
                err: error instanceof Error ? error.message : String(error),
              },
              'could not delete expired export file',
            ),
          );
        }
      }
      log.info({ expired: expired.rows.length }, 'export expiry run');
      return;
    }
    if (kind === 'audit.partitions') {
      if (!migratorUrl) {
        log.warn('audit.partitions needs DATABASE_MIGRATOR_URL; skipped');
        return;
      }
      const client = new Client({
        connectionString: migratorUrl,
        application_name: 'edupro-workers-maintenance',
      });
      await client.connect();
      try {
        await client.query('CALL app.ensure_audit_partitions(2)');
        log.info('audit partitions ensured');
      } finally {
        await client.end();
      }
      return;
    }
    log.warn({ kind }, 'unknown maintenance job kind');
  };
}

export const SYSTEM_ENVELOPE = (kind: string): JobEnvelope => ({
  schoolId: '0',
  userId: null,
  requestId: null,
  kind,
  payload: {},
});
