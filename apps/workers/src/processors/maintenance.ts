import { Client } from 'pg';
import { providerFromEnv, writeNarrative } from '@edupro/ai';
import {
  collectReportFacts,
  nextCronRun,
  REPORT_DEPARTMENTS,
  type Db,
  type JobEnvelope,
  type ReportDepartment,
} from '@edupro/db';
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
    if (kind === 'shadow.reconcile') {
      // Sprint 16: the daily shadow-run reconciliation (yesterday to today) per school; a run with open
      // variances raises an insight alert and the usual notification.
      const schools = { rows: await schoolsFor(db, job) };
      let variance = 0;
      for (const { id } of schools.rows) {
        const tenant = { schoolId: id, userId: null, allowedSchoolIds: [id] };
        try {
          await db.withTenant(tenant, async (c) => {
            const fed = await c.query('SELECT 1 FROM shadow_legacy_receipts LIMIT 1');
            if (fed.rowCount === 0) return; // no shadow run for this school
            const r = await c.query<{
              id: string;
              status: string;
              open_variances: number;
              variance_amount: string;
              to_date: Date;
            }>(
              'SELECT id::text, status, open_variances, variance_amount::text, to_date FROM app.run_shadow_reconcile(CURRENT_DATE - 1, CURRENT_DATE)',
            );
            const run = r.rows[0]!;
            if (run.status === 'variance') {
              variance += 1;
              await c.query(
                `INSERT INTO insight_alerts (school_id, kind, severity, subject_type, subject_id, title, message, data)
                 VALUES (app.current_school_id(), 'shadow.variance', 'danger', 'shadow_run', $1::bigint, 'Shadow run variance',
                         format('%s open variance(s) worth ₹%s between the legacy and the new ledger', $2::int, $3::text),
                         jsonb_build_object('runId', $1::bigint, 'openVariances', $2::int, 'varianceAmount', $3::text))
                 ON CONFLICT DO NOTHING`,
                [run.id, run.open_variances, run.variance_amount],
              );
              await notifyInsightAlerts(c, id);
            }
          });
        } catch (error) {
          log.error({ err: error, schoolId: id }, 'shadow reconcile failed for a school');
        }
      }
      log.info({ schools: schools.rows.length, variance }, 'shadow reconcile run');
      return;
    }
    if (kind === 'insights.reports') {
      // Sprint 16 (AI track): the Monday brief and the department weeklies for the previous week (Mon-Sun),
      // as ai_reports rows, PDF exports and a WhatsApp summary to the alert roles.
      const provider = providerFromEnv({
        AI_PROVIDER: process.env.AI_PROVIDER,
        AI_MODEL: process.env.AI_MODEL,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        NODE_ENV: process.env.NODE_ENV,
      });
      const schools = { rows: await schoolsFor(db, job) };
      const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
      ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 7) % 7 || 7));
      const to = ist.toISOString().slice(0, 10);
      const fromD = new Date(`${to}T00:00:00Z`);
      fromD.setUTCDate(fromD.getUTCDate() - 6);
      const from = fromD.toISOString().slice(0, 10);
      let written = 0;
      for (const { id } of schools.rows) {
        const tenant = { schoolId: id, userId: null, allowedSchoolIds: [id] };
        try {
          await db.withTenant(tenant, async (c) => {
            const school = await c.query<{ name: string }>(
              'SELECT name FROM schools WHERE id = app.current_school_id()',
            );
            const scopes: Array<{
              kind: 'principal_brief' | 'department_weekly';
              department?: ReportDepartment;
              title: string;
            }> = [
              { kind: 'principal_brief', title: "Principal's Monday brief" },
              ...REPORT_DEPARTMENTS.map((d) => ({
                kind: 'department_weekly' as const,
                department: d,
                title: `${d[0]!.toUpperCase()}${d.slice(1)} weekly`,
              })),
            ];
            const summaries: string[] = [];
            for (const sc of scopes) {
              const facts = await collectReportFacts(c, {
                kind: sc.kind,
                department: sc.department,
                from,
                to,
              });
              const out = await writeNarrative(provider, {
                title: sc.title,
                period: `${from} to ${to}`,
                school: school.rows[0]?.name ?? '',
                audience: sc.kind === 'principal_brief' ? 'principal' : 'department',
                facts,
                language: 'en',
              });
              if (out.unknownCitations.length) {
                log.warn(
                  { schoolId: id, kind: sc.kind, unknown: out.unknownCitations },
                  'ai report cited unknown facts; not published',
                );
                continue;
              }
              const rep = await c.query<{ id: string }>(
                `INSERT INTO ai_reports (school_id, kind, department, period_from, period_to, language, title, narrative, facts, citations, provider, model, cost_paise)
                 VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, 'en', $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
                 ON CONFLICT (school_id, kind, COALESCE(department, ''), period_to) DO UPDATE
                   SET narrative = EXCLUDED.narrative, facts = EXCLUDED.facts, citations = EXCLUDED.citations, provider = EXCLUDED.provider, model = EXCLUDED.model, cost_paise = EXCLUDED.cost_paise, created_at = now()
                 RETURNING id::text`,
                [
                  sc.kind,
                  sc.department ?? null,
                  from,
                  to,
                  sc.title,
                  out.narrative,
                  JSON.stringify(facts),
                  JSON.stringify(out.citations),
                  out.provider,
                  out.model,
                  out.costPaise,
                ],
              );
              const exp = await c.query<{ id: string }>(
                `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
                 VALUES (app.current_school_id(), 'ai_report', 'pdf', $1::jsonb, $2, NULL, NULL) RETURNING id::text`,
                [JSON.stringify({ reportId: rep.rows[0]!.id }), sc.title],
              );
              await c.query("SELECT app.enqueue_job('exports', $1::jsonb)", [
                JSON.stringify({
                  schoolId: id,
                  userId: null,
                  requestId: null,
                  kind: 'export.generate',
                  payload: { exportId: exp.rows[0]!.id },
                }),
              ]);
              await c.query('UPDATE ai_reports SET export_id = $2 WHERE id = $1', [
                rep.rows[0]!.id,
                exp.rows[0]!.id,
              ]);
              written += 1;
              if (sc.kind === 'principal_brief')
                summaries.push(out.narrative.split('\n').slice(0, 4).join('\n').slice(0, 600));
            }
            if (summaries.length) {
              // the WhatsApp summary goes to the alert roles; the PDF waits in Reports → Export centre
              const roles = await c.query(
                `SELECT COALESCE(app.setting('insights.alert_roles') #>> '{}', 'school_admin') AS roles`,
              );
              const codes = String(roles.rows[0]?.roles ?? 'school_admin')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);
              const recipients = await c.query<{ id: string; mobile: string }>(
                `SELECT DISTINCT u.id::text, u.mobile FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
                  WHERE ur.school_id = app.current_school_id() AND r.code = ANY($1::text[]) AND ur.revoked_at IS NULL AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
                    AND u.mobile IS NOT NULL AND u.deleted_at IS NULL`,
                [codes],
              );
              const body = `${school.rows[0]?.name ?? ''} — Monday brief (${from} to ${to})\n${summaries[0]}\nThe PDF and the department weeklies are under Insights → Reports.`;
              for (const u of recipients.rows) {
                const m = await c.query<{ id: string }>(
                  `INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, body, status) VALUES (app.current_school_id(), 'whatsapp', $1, $2, $3, 'queued') RETURNING id::text`,
                  [u.id, u.mobile, body],
                );
                await c.query("SELECT app.enqueue_job('notifications', $1::jsonb)", [
                  JSON.stringify({
                    schoolId: id,
                    userId: null,
                    requestId: null,
                    kind: 'comms.message',
                    payload: { messageId: m.rows[0]!.id },
                  }),
                ]);
                await c.query(
                  `UPDATE ai_reports SET message_ids = array_append(message_ids, $2::bigint) WHERE kind = 'principal_brief' AND period_to = $1::date`,
                  [to, m.rows[0]!.id],
                );
              }
            }
          });
        } catch (error) {
          log.error({ err: error, schoolId: id }, 'ai reports failed for a school');
        }
      }
      log.info({ schools: schools.rows.length, written, from, to }, 'ai reports run');
      return;
    }
    if (kind === 'insights.alerts') {
      // Sprint 15 (AI track): anomaly alerts v1 per school — attendance drop, collection dip, silent reader.
      // One row per kind, subject and day; new rows are pushed to the users of the roles named by the
      // setting insights.alert_roles through the insight_alert template (whatsapp to the user's mobile).
      const schools = { rows: await schoolsFor(db, job) };
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
      const schools = { rows: await schoolsFor(db, job) };
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
      const schools = { rows: await schoolsFor(db, job) };
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
    if (kind === 'workflow.sla') {
      // Sprint 17: remind the assignees of overdue steps once, then escalate after the grace period
      // (the level's own escalation, else the roles in workflow.escalate_roles).
      const schools = { rows: await schoolsFor(db, job) };
      let reminded = 0;
      let escalated = 0;
      for (const s of schools.rows) {
        try {
          const r = await db.withTenant(
            { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
            (c) => runWorkflowSla(c, s.id),
          );
          reminded += r.reminded;
          escalated += r.escalated;
        } catch (error) {
          log.error({ err: error, schoolId: s.id }, 'workflow sla failed for school');
        }
      }
      log.info({ schools: schools.rows.length, reminded, escalated }, 'workflow sla run');
      return;
    }
    if (kind === 'transport.positions.expire') {
      // Sprint 17: keep only the configured days of GPS positions per school.
      const schools = { rows: await schoolsFor(db, job) };
      let deleted = 0;
      for (const s of schools.rows) {
        const r = await db.withTenant(
          { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
          (c) =>
            c.query(
              `DELETE FROM vehicle_positions WHERE received_at < now() - make_interval(days => COALESCE((app.setting('transport.gps_retention_days') #>> '{}')::int, 30))`,
            ),
        );
        deleted += r.rowCount ?? 0;
      }
      log.info({ deleted }, 'vehicle positions purge run');
      return;
    }
    if (kind === 'retention.purge') {
      // Sprint 20: DPDP storage limitation. Per school, each policy reads its setting (legal minimums are
      // enforced by the settings catalogue) and writes one retention_runs row; financial and academic
      // records are never touched (ADR-014 archive covers those).
      const schools = { rows: await schoolsFor(db, job) };
      const policies: Array<{ policy: string; setting: string; def: number; sql: string }> = [
        {
          policy: 'comms_body',
          setting: 'privacy.retention.comms_body_days',
          def: 180,
          sql: `WITH d AS (UPDATE comms_messages SET body = '[retained metadata]', variables = '{}'::jsonb WHERE created_at < now() - make_interval(days => $1) AND body <> '[retained metadata]' AND body <> '[erased]' RETURNING 1) SELECT count(*)::int AS n FROM d`,
        },
        {
          policy: 'login_events',
          setting: 'privacy.retention.login_events_days',
          def: 365,
          sql: `SELECT app.purge_login_events($1::int) AS n`,
        },
        {
          policy: 'visitor_log',
          setting: 'privacy.retention.visitor_log_days',
          def: 365,
          sql: `WITH d AS (DELETE FROM visitor_log WHERE in_at < now() - make_interval(days => $1) RETURNING 1) SELECT count(*)::int AS n FROM d`,
        },
        {
          policy: 'ai_messages',
          setting: 'privacy.retention.ai_messages_days',
          def: 180,
          sql: `WITH d AS (DELETE FROM ai_messages WHERE created_at < now() - make_interval(days => $1) RETURNING 1) SELECT count(*)::int AS n FROM d`,
        },
      ];
      let total = 0;
      for (const s of schools.rows) {
        await db.withTenant(
          { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
          async (c) => {
            for (const p of policies) {
              const setting = await c.query<{ v: string | null }>(
                `SELECT app.setting($1) #>> '{}' AS v`,
                [p.setting],
              );
              const days = Number(setting.rows[0]?.v ?? p.def) || p.def;
              const r = await c.query<{ n: number }>(p.sql, [days]);
              const affected = Number(r.rows[0]?.n ?? 0);
              await c.query(
                `INSERT INTO retention_runs (school_id, policy, keep_days, affected) VALUES (app.current_school_id(), $1, $2, $3)`,
                [p.policy, days, affected],
              );
              total += affected;
            }
          },
        );
      }
      log.info({ schools: schools.rows.length, affected: total }, 'retention purge run');
      return;
    }
    if (kind === 'insights.results_mart') {
      const schools = { rows: await schoolsFor(db, job) };
      let rows = 0;
      for (const s of schools.rows) {
        const r = await db.withTenant(
          { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
          (c) => c.query<{ n: number }>('SELECT app.refresh_exam_results_mart() AS n'),
        );
        rows += Number(r.rows[0]?.n ?? 0);
      }
      log.info({ schools: schools.rows.length, rows }, 'exam results mart run');
      return;
    }
    if (kind === 'reports.scheduled') {
      // Sprint 19: run the due schedules as their owner (an export row + job), tell the recipients where the file lands.
      const schools = { rows: await schoolsFor(db, job) };
      let ran = 0;
      for (const s of schools.rows) {
        const due = await db.withTenant(
          { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
          (c) =>
            c.query<{
              id: string;
              name: string;
              dataset: string;
              format: string;
              params: Record<string, unknown>;
              cron: string;
              recipient_roles: string[];
              recipient_addresses: string[];
              channel: string;
              owner_id: string;
            }>(
              `SELECT id::text, name, dataset, format, params, cron, recipient_roles, recipient_addresses, channel::text, owner_id::text
               FROM report_schedules WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now() ORDER BY next_run_at`,
            ),
        );
        for (const sch of due.rows) {
          try {
            await db.withTenant(
              { schoolId: s.id, userId: sch.owner_id, allowedSchoolIds: [s.id] },
              async (c) => {
                const exp = await c.query<{ id: string }>(
                  `INSERT INTO exports (school_id, dataset, format, params, title, requested_by)
                 VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, $5) RETURNING id::text`,
                  [
                    sch.dataset,
                    sch.format,
                    JSON.stringify(sch.params ?? {}),
                    sch.name,
                    sch.owner_id,
                  ],
                );
                await c.query("SELECT app.enqueue_job('exports', $1::jsonb)", [
                  JSON.stringify({
                    schoolId: s.id,
                    userId: sch.owner_id,
                    requestId: null,
                    kind: 'export.generate',
                    payload: { exportId: exp.rows[0]!.id },
                  }),
                ]);
                const next = nextCronRun(sch.cron, new Date());
                await c.query(
                  `UPDATE report_schedules SET last_run_at = now(), last_export_id = $2, next_run_at = $3 WHERE id = $1`,
                  [sch.id, exp.rows[0]!.id, next],
                );
                const users = await c.query<{
                  id: string;
                  mobile: string | null;
                  email: string | null;
                }>(
                  `SELECT DISTINCT u.id::text, u.mobile, u.email FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
                  WHERE ur.school_id = app.current_school_id() AND r.code = ANY($1::text[]) AND ur.revoked_at IS NULL AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) AND u.deleted_at IS NULL`,
                  [sch.recipient_roles],
                );
                const body = `Scheduled report "${sch.name}" (${sch.format.toUpperCase()}) is being prepared. Open Reports → Exports, export #${exp.rows[0]!.id}, to download it.`;
                const targets: Array<{ userId: string | null; address: string }> = [];
                for (const u of users.rows) {
                  const addr = sch.channel === 'email' ? u.email : u.mobile;
                  if (addr) targets.push({ userId: u.id, address: addr });
                }
                for (const a of sch.recipient_addresses) targets.push({ userId: null, address: a });
                for (const t of targets) {
                  const m = await c.query<{ id: string }>(
                    `INSERT INTO comms_messages (school_id, channel, recipient_user_id, recipient_address, subject, body, status)
                   VALUES (app.current_school_id(), $1::comms_channel, $2, $3, $4, $5, 'queued') RETURNING id::text`,
                    [sch.channel, t.userId, t.address, `Scheduled report: ${sch.name}`, body],
                  );
                  await c.query("SELECT app.enqueue_job('notifications', $1::jsonb)", [
                    JSON.stringify({
                      schoolId: s.id,
                      userId: null,
                      requestId: null,
                      kind: 'comms.message',
                      payload: { messageId: m.rows[0]!.id },
                    }),
                  ]);
                }
              },
            );
            ran += 1;
          } catch (error) {
            log.error({ err: error, scheduleId: sch.id }, 'scheduled report failed');
          }
        }
      }
      log.info({ schools: schools.rows.length, ran }, 'scheduled reports run');
      return;
    }
    if (kind === 'archive.closed_years') {
      // Sprint 18 (ADR-014): move closed years' attendance marks (beyond the two most recent) to the archive schema.
      const schools = { rows: await schoolsFor(db, job) };
      let moved = 0;
      for (const s of schools.rows) {
        const r = await db.withTenant(
          { schoolId: s.id, userId: null, allowedSchoolIds: [s.id] },
          (c) => c.query<{ n: number }>('SELECT app.archive_closed_years() AS n'),
        );
        moved += Number(r.rows[0]?.n ?? 0);
      }
      log.info({ schools: schools.rows.length, moved }, 'archive closed years run');
      return;
    }
    log.warn({ kind }, 'unknown maintenance job kind');
  };
}

/** System jobs run for every school; `schoolIds` narrows a run to some (on-demand runs, tests). */
export const SYSTEM_ENVELOPE = (kind: string, only?: { schoolIds: string[] }): JobEnvelope => ({
  schoolId: '0',
  userId: null,
  requestId: null,
  kind,
  payload: only ?? {},
});

/** The schools a system job runs for: every school with data, or the envelope's own list. */
async function schoolsFor(db: Db, job: JobLike<unknown>): Promise<Array<{ id: string }>> {
  const only = (job.data as JobEnvelope<{ schoolIds?: string[] }>).payload?.schoolIds;
  if (Array.isArray(only) && only.length > 0) return only.map((id) => ({ id: String(id) }));
  const r = await db.withoutTenant((c) =>
    c.query<{ id: string }>('SELECT o_school_id::text AS id FROM app.mart_schools()'),
  );
  return r.rows;
}

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

type Q = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

/** WhatsApp to a set of users through the notifications queue (template body with {{subject}} and {{step}}). */
async function notifyUsers(
  c: Q,
  schoolId: string,
  userIds: string[],
  body: string,
): Promise<number> {
  const users = await c.query<{ id: string; mobile: string }>(
    `SELECT id::text, mobile FROM users WHERE id = ANY($1::bigint[]) AND mobile IS NOT NULL AND deleted_at IS NULL`,
    [userIds],
  );
  let n = 0;
  for (const u of users.rows) {
    const m = await c.query<{ id: string }>(
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
  return n;
}

/** Users of a resolver (role, named user, position); the approver chain has no requester here and falls back. */
async function resolveEscalation(
  c: Q,
  resolver: Record<string, unknown> | null,
): Promise<string[]> {
  if (resolver?.kind === 'named_user') return [String(resolver.userId)];
  if (resolver?.kind === 'position') {
    const r = await c.query<{ id: string }>(
      `SELECT DISTINCT user_id::text AS id FROM employees WHERE designation ILIKE $1 AND user_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
      [String(resolver.designation)],
    );
    return r.rows.map((x) => x.id);
  }
  const roles =
    resolver?.kind === 'role'
      ? [String(resolver.roleCode)]
      : String(
          (
            await c.query<{ v: string }>(
              `SELECT COALESCE(app.setting('workflow.escalate_roles') #>> '{}', 'school_admin') AS v`,
            )
          ).rows[0]?.v ?? 'school_admin',
        )
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
  const r = await c.query<{ id: string }>(
    `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.school_id = app.current_school_id() AND r.code = ANY($1::text[]) AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
    [roles],
  );
  return r.rows.map((x) => x.id);
}

export async function runWorkflowSla(
  c: Q,
  schoolId: string,
): Promise<{ reminded: number; escalated: number }> {
  const grace = Number(
    (
      await c.query<{ v: string }>(
        `SELECT COALESCE(app.setting('workflow.escalate_after_hours') #>> '{}', '24') AS v`,
      )
    ).rows[0]?.v ?? 24,
  );
  const due = await c.query<{
    id: string;
    instance_id: string;
    level: number;
    name: string;
    subject: string;
    assignees: string[];
    reminded_at: Date | null;
    escalated_at: Date | null;
    overdue_hours: number;
    escalate_to: Record<string, unknown> | null;
  }>(
    `SELECT s.id::text, s.instance_id::text, s.level, s.name, i.subject, s.assignee_user_ids::text[] AS assignees, s.reminded_at, s.escalated_at,
            EXTRACT(EPOCH FROM (now() - s.due_at)) / 3600 AS overdue_hours,
            (SELECT l.value->'escalateTo' FROM jsonb_array_elements(d.levels) AS l(value) WHERE (l.value->>'level')::int = s.level) AS escalate_to
       FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id JOIN workflow_definitions d ON d.id = i.definition_id
      WHERE s.status = 'pending' AND i.status = 'pending' AND i.current_level = s.level AND s.due_at IS NOT NULL AND s.due_at < now()
        AND (s.reminded_at IS NULL OR s.escalated_at IS NULL)
      ORDER BY s.due_at`,
  );
  let reminded = 0;
  let escalated = 0;
  for (const step of due.rows) {
    if (!step.reminded_at) {
      await notifyUsers(
        c,
        schoolId,
        step.assignees,
        `Approval pending: "${step.subject}" (${step.name}) is past its due time. Please act in your inbox.`,
      );
      await c.query(`UPDATE workflow_steps SET reminded_at = now() WHERE id = $1`, [step.id]);
      await c.query(
        `INSERT INTO workflow_events (school_id, instance_id, step_id, kind, note, detail) VALUES (app.current_school_id(), $1, $2, 'reminded', $3, $4::jsonb)`,
        [
          step.instance_id,
          step.id,
          `Reminder sent to ${step.assignees.length} assignee(s)`,
          JSON.stringify({ assignees: step.assignees }),
        ],
      );
      reminded += 1;
    }
    if (!step.escalated_at && Number(step.overdue_hours) >= grace) {
      const extra = (await resolveEscalation(c, step.escalate_to)).filter(
        (u) => !step.assignees.includes(u),
      );
      await c.query(
        `UPDATE workflow_steps SET assignee_user_ids = assignee_user_ids || $2::bigint[], escalated_to = $2::bigint[], escalated_at = now() WHERE id = $1`,
        [step.id, extra],
      );
      if (extra.length)
        await notifyUsers(
          c,
          schoolId,
          extra,
          `Escalated to you: "${step.subject}" (${step.name}) has waited ${Math.round(Number(step.overdue_hours))} h past its due time.`,
        );
      await c.query(
        `INSERT INTO workflow_events (school_id, instance_id, step_id, kind, note, detail) VALUES (app.current_school_id(), $1, $2, 'escalated', $3, $4::jsonb)`,
        [
          step.instance_id,
          step.id,
          extra.length
            ? `Escalated to ${extra.length} member(s)`
            : 'Escalation found nobody to add',
          JSON.stringify({ added: extra }),
        ],
      );
      escalated += 1;
    }
  }
  return { reminded, escalated };
}
