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
    if (kind === 'break_glass.expire') {
      // S5-03: revoke expired emergency grants and send the post-review report to the security lead.
      const expired = await db.withoutTenant((c) =>
        c.query<{
          o_event_id: string;
          o_school_id: string;
          o_user_id: string;
          o_user_name: string;
          o_role_name: string;
          o_reason: string;
          o_started_at: Date;
          o_expires_at: Date;
        }>(
          'SELECT o_event_id::text, o_school_id::text, o_user_id::text, o_user_name, o_role_name, o_reason, o_started_at, o_expires_at FROM app.expire_break_glass($1)',
          [100],
        ),
      );
      for (const ev of expired.rows) {
        const tenant = {
          schoolId: ev.o_school_id,
          userId: null,
          allowedSchoolIds: [ev.o_school_id],
        };
        await db.withTenant(tenant, async (c) => {
          const actions = await c.query<{ action: string; n: string }>(
            'SELECT action, count(*)::text AS n FROM audit_logs WHERE actor_user_id = $1 AND occurred_at BETWEEN $2 AND $3 GROUP BY action ORDER BY n DESC',
            [ev.o_user_id, ev.o_started_at, ev.o_expires_at],
          );
          const lines = actions.rows.map((a) => `${a.n} x ${a.action}`);
          const lead = await c.query<{ email: string | null }>(
            "SELECT (app.setting('security.break_glass_email') #>> '{}') AS email",
          );
          const email = lead.rows[0]?.email;
          if (email) {
            const m = await c.query<{ id: string }>(
              `INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, status)
               VALUES (app.current_school_id(), 'email', $1, $2, $3, 'queued') RETURNING id::text`,
              [
                email,
                `Break-glass report: ${ev.o_user_name} (${ev.o_role_name})`,
                `Window ${ev.o_started_at.toISOString()} to ${ev.o_expires_at.toISOString()}\nReason: ${ev.o_reason}\nActions recorded in the audit log:\n${lines.length ? lines.join('\n') : '(none)'}\nReview the audit log for details; the grant has been revoked.`,
              ],
            );
            await c.query("SELECT app.enqueue_job('notifications', $1::jsonb)", [
              JSON.stringify({
                schoolId: ev.o_school_id,
                userId: null,
                requestId: null,
                kind: 'comms.message',
                payload: { messageId: m.rows[0]!.id },
              }),
            ]);
          }
          await c.query('UPDATE break_glass_events SET report_sent_at = now() WHERE id = $1', [
            ev.o_event_id,
          ]);
        });
        log.info(
          { eventId: ev.o_event_id, schoolId: ev.o_school_id, actions: 'reported' },
          'break-glass window closed',
        );
      }
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
