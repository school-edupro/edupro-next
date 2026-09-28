import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorageDriver } from '@edupro/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintenanceProcessor, SYSTEM_ENVELOPE } from '../src/processors/maintenance';
import {
  log as silent,
  newDb,
  seedSchool,
  stamp,
  withMigrator,
  type SeededSchool,
} from './helpers';

// errors of the jobs under test surface in the output instead of vanishing into the silent logger
const log = {
  ...silent,
  error: (o: unknown, msg?: string) =>
    console.error(msg, (o as { err?: Error })?.err?.message ?? o),
} as typeof silent;

describe('maintenance: shadow reconcile and AI reports (Sprint 16)', () => {
  const db = newDb();
  let school: SeededSchool;
  let dir: string;
  const run = (kind: string) =>
    maintenanceProcessor({
      db,
      storage: createStorageDriver({ driver: 'local', localDir: dir, urlTtlSeconds: 60 }),
      log,
      migratorUrl: undefined,
    })({
      data: SYSTEM_ENVELOPE(kind, { schoolIds: [school.id] }),
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
  const startedAt = new Date();
  beforeAll(async () => {
    school = await seedSchool(stamp('WS16'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-s16-'));
    await withMigrator(async (c) => {
      const role = await c.query<{ id: string }>(
        "SELECT id::text FROM roles WHERE code = 'school_admin' AND school_id IS NULL",
      );
      await c.query(`UPDATE users SET mobile = '9876516099' WHERE id = $1`, [school.userId]);
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 's16 test') ON CONFLICT DO NOTHING`,
        [school.id, school.userId, role.rows[0]!.id],
      );
      // a legacy receipt fed yesterday that could not be posted (unknown pupil): the run must show a variance
      const feed = await c.query<{ id: string }>(
        `INSERT INTO shadow_feeds (school_id, kind, source, rows, accepted) VALUES ($1, 'receipts', 'test', 1, 1) RETURNING id::text`,
        [school.id],
      );
      await c.query(
        `INSERT INTO shadow_legacy_receipts (school_id, feed_id, legacy_receipt_no, admission_no, received_on, amount, mode, post_error)
         VALUES ($1, $2, 'TF7001', 'UNKNOWN-1', CURRENT_DATE - 1, 2500, 'cash', 'student_unknown')`,
        [school.id, feed.rows[0]!.id],
      );
      // marts for the report facts (one week of attendance and collections)
      const cls = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
        [school.id],
      );
      const sec = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
        [school.id, school.yearId, cls.rows[0]!.id],
      );
      for (let back = 13; back >= 0; back -= 1) {
        await c.query(
          `INSERT INTO mart.attendance_daily (school_id, academic_year_id, on_date, class_section_id, class_id, section, strength, present, absent, late, marked)
           VALUES ($1, $2, CURRENT_DATE - $3::int, $4, $5, 'VI-A', 30, $6, $7, 0, true)`,
          [
            school.id,
            school.yearId,
            back,
            sec.rows[0]!.id,
            cls.rows[0]!.id,
            back >= 7 ? 28 : 26,
            back >= 7 ? 2 : 4,
          ],
        );
        await c.query(
          `INSERT INTO mart.fee_collection_daily (school_id, academic_year_id, received_on, mode, receipts, amount) VALUES ($1, $2, CURRENT_DATE - $3::int, 'cash', 2, 5000)`,
          [school.id, school.yearId, back],
        );
      }
    });
  });
  afterAll(async () => {
    // the jobs run for every school in the local database (hundreds left by e2e runs); drop the export and
    // WhatsApp outbox rows they queued so the outbox stays small for the publisher tests
    await withMigrator((c) =>
      c.query(
        `DELETE FROM jobs_outbox WHERE status = 'pending' AND created_at >= $1
            AND payload->>'kind' IN ('export.generate', 'comms.message')`,
        [startedAt],
      ),
    );
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('shadow.reconcile writes the run, raises the variance alert once and queues the WhatsApp', async () => {
    await run('shadow.reconcile');
    await run('shadow.reconcile');
    const out = await withMigrator(async (c) => ({
      runs: (
        await c.query(
          'SELECT status, open_variances, variance_amount::text AS amount FROM shadow_runs WHERE school_id = $1',
          [school.id],
        )
      ).rows,
      alerts: (
        await c.query(
          "SELECT kind, severity, notified_at IS NOT NULL AS notified FROM insight_alerts WHERE school_id = $1 AND kind = 'shadow.variance'",
          [school.id],
        )
      ).rows,
      messages: Number(
        (
          await c.query(
            "SELECT count(*) FROM comms_messages WHERE school_id = $1 AND body LIKE '%Shadow run variance%'",
            [school.id],
          )
        ).rows[0]!.count,
      ),
    }));
    expect(out.runs).toEqual([{ status: 'variance', open_variances: 1, amount: '2500.00' }]);
    expect(out.alerts).toEqual([{ kind: 'shadow.variance', severity: 'danger', notified: true }]);
    expect(out.messages).toBe(1);
  });

  it('insights.reports writes the brief and the four weeklies with citations, queues their PDFs and one WhatsApp summary', async () => {
    await run('insights.reports');
    const out = await withMigrator(async (c) => ({
      reports: (
        await c.query(
          'SELECT kind, department, provider, jsonb_array_length(citations) AS cites, export_id IS NOT NULL AS has_export FROM ai_reports WHERE school_id = $1 ORDER BY kind, department',
          [school.id],
        )
      ).rows,
      exports: (
        await c.query(
          "SELECT dataset, format, status::text FROM exports WHERE school_id = $1 AND dataset = 'ai_report'",
          [school.id],
        )
      ).rows,
      messages: (
        await c.query(
          "SELECT body FROM comms_messages WHERE school_id = $1 AND body LIKE '%Monday brief%'",
          [school.id],
        )
      ).rows,
      queued: Number(
        (
          await c
            .query(
              "SELECT count(*) FROM app.outbox_jobs WHERE school_id = $1 AND kind = 'export.generate'",
              [school.id],
            )
            .catch(() => ({ rows: [{ count: '-1' }] }))
        ).rows[0]!.count,
      ),
    }));
    expect(out.reports.map((r) => `${r.kind}:${r.department ?? ''}`)).toEqual([
      'department_weekly:academics',
      'department_weekly:attendance',
      'department_weekly:communication',
      'department_weekly:fees',
      'principal_brief:',
    ]);
    expect(
      out.reports.every((r) => r.provider === 'mock' && Number(r.cites) >= 1 && r.has_export),
    ).toBe(true);
    expect(out.exports).toHaveLength(5);
    expect(out.exports.every((e) => e.format === 'pdf' && e.status === 'queued')).toBe(true);
    expect(out.messages).toHaveLength(1);
    expect(String(out.messages[0]!.body)).toContain('[attendance.pct]');
    // a second run of the same week replaces the narrative, adds nothing
    await run('insights.reports');
    const again = await withMigrator(async (c) =>
      Number(
        (await c.query('SELECT count(*) FROM ai_reports WHERE school_id = $1', [school.id]))
          .rows[0]!.count,
      ),
    );
    expect(again).toBe(5);
  });
});
