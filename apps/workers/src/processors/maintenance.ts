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
    if (kind === 'insights.alerts') {
      // Sprint 15 (AI track): anomaly alerts v1 per school — attendance drop, collection dip, silent reader.
      // One row per kind, subject and day; new rows are pushed to the users of the roles named by the
      // setting insights.alert_roles through the insight_alert template (whatsapp to the user's mobile).
      const schools = await db.withoutTenant((c) =>
        c.query<{ id: string }>('SELECT o_school_id::text AS id FROM app.mart_schools()'),
      );
      let created = 0;
      let notified = 0;
      for (const { id } of schools.rows) {
        const tenant = { schoolId: id, userId: null, allowedSchoolIds: [id] };
        try {
          await db.withTenant(tenant, async (c) => {
            const r = await c.query<{ created: number }>(
              'SELECT app.detect_insight_alerts() AS created',
            );
            created += r.rows[0]?.created ?? 0;
            notified += await notifyInsightAlerts(c, id);
          });
        } catch (error) {
          log.error({ err: error, schoolId: id }, 'insight alerts failed for a school');
        }
      }
      log.info({ schools: schools.rows.length, created, notified }, 'insight alerts run');
      return;
    }
    if (kind === 'insights.refresh') {
      // Sprint 12 (AI track): rebuild the reporting marts of every active school under its own tenant context.
      const schools = await db.withoutTenant((c) =>
        c.query<{ id: string }>('SELECT o_school_id::text AS id FROM app.mart_schools()'),
      );
      let refreshed = 0;
      for (const s of schools.rows) {
        try {
          const r = await db.withTenant(
            { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
            (c) =>
              c.query<{ o_mart: string; o_rows: number; o_ms: number }>(
                'SELECT o_mart, o_rows, o_ms FROM app.refresh_marts()',
              ),
          );
          refreshed += 1;
          log.debug(
            { schoolId: s.id, marts: Object.fromEntries(r.rows.map((x) => [x.o_mart, x.o_rows])) },
            'marts refreshed',
          );
        } catch (error) {
          log.error(
            { schoolId: s.id, err: error instanceof Error ? error.message : String(error) },
            'mart refresh failed',
          );
        }
      }
      log.info({ schools: schools.rows.length, refreshed }, 'insights refresh run');
      return;
    }
    if (kind === 'payments.reconcile') {
      // Sprint 14: reconcile online receipts against settlement lines for every active school (idempotent per day).
      const schools = await db.withoutTenant((c) =>
        c.query<{ id: string }>('SELECT o_school_id::text AS id FROM app.mart_schools()'),
      );
      let ran = 0;
      let flagged = 0;
      for (const s of schools.rows) {
        try {
          const r = await db.withTenant(
            { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
            (c) =>
              c.query<{
                aged_unsettled: number;
                mismatched_lines: number;
                succeeded_without_receipt: number;
                variance: string;
              }>(
                'SELECT aged_unsettled, mismatched_lines, succeeded_without_receipt, variance::text FROM app.reconcile_payments(CURRENT_DATE)',
              ),
          );
          ran += 1;
          const row = r.rows[0];
          if (
            row &&
            (row.aged_unsettled > 0 ||
              row.mismatched_lines > 0 ||
              row.succeeded_without_receipt > 0 ||
              Number(row.variance) !== 0)
          ) {
            flagged += 1;
            log.warn({ schoolId: s.id, ...row }, 'reconciliation variance');
          }
        } catch (error) {
          log.error(
            { schoolId: s.id, err: error instanceof Error ? error.message : String(error) },
            'reconciliation failed',
          );
        }
      }
      log.info({ schools: schools.rows.length, ran, flagged }, 'payments reconciliation run');
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

/** Queues the insight_alert message to every recipient for alerts not yet notified; returns the count. */
export async function notifyInsightAlerts(
  c: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  schoolId: string,
): Promise<number> {
  await c.query(
    `INSERT INTO comms_templates (school_id, code, channel, name, body, variables, is_alert)
     VALUES (app.current_school_id(), 'insight_alert', 'whatsapp', 'Insight alert', '{{school}} alert. {{title}}: {{message}}', '["title","message","school"]'::jsonb, true)
     ON CONFLICT (school_id, code, channel) DO NOTHING`,
  );
  const pending = await c.query(
    `SELECT a.id::text, a.title, a.message, (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
            (SELECT body FROM comms_templates t WHERE t.school_id = app.current_school_id() AND t.code = 'insight_alert' AND t.channel = 'whatsapp' AND t.status = 'active' AND t.deleted_at IS NULL) AS body
       FROM insight_alerts a WHERE a.notified_at IS NULL ORDER BY a.id`,
  );
  if (pending.rows.length === 0) return 0;
  const roles = await c.query(
    `SELECT COALESCE(app.setting('insights.alert_roles') #>> '{}', 'school_admin') AS roles`,
  );
  const codes = String(roles.rows[0]?.roles ?? 'school_admin')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const recipients = await c.query(
    `SELECT DISTINCT u.id::text, u.mobile FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
      WHERE ur.school_id = app.current_school_id() AND r.code = ANY($1::text[]) AND ur.revoked_at IS NULL AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
        AND u.mobile IS NOT NULL AND u.deleted_at IS NULL`,
    [codes],
  );
  let n = 0;
  for (const a of pending.rows) {
    const render = (tpl: string) =>
      tpl
        .replace(/\{\{title\}\}/g, String(a.title))
        .replace(/\{\{message\}\}/g, String(a.message))
        .replace(/\{\{school\}\}/g, String(a.school ?? ''));
    const body = render(String(a.body ?? '{{school}} alert. {{title}}: {{message}}'));
    for (const u of recipients.rows) {
      const m = await c.query(
        `INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, body, status)
         VALUES (app.current_school_id(), 'whatsapp', $1, $2, $3, 'queued') RETURNING id::text`,
        [u.id, u.mobile, body],
      );
      await c.query("SELECT app.enqueue_job('notifications', $1::jsonb)", [
        JSON.stringify({
          schoolId,
          userId: null,
          requestId: null,
          kind: 'comms.message',
          payload: { messageId: m.rows[0]!.id },
        }),
      ]);
      n += 1;
    }
    await c.query('UPDATE insight_alerts SET notified_at = now() WHERE id = $1', [a.id]);
  }
  return n;
}
