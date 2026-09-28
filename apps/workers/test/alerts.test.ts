import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorageDriver } from '@edupro/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintenanceProcessor, SYSTEM_ENVELOPE } from '../src/processors/maintenance';
import { log, newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

describe('maintenance: anomaly alerts v1 (Sprint 15)', () => {
  const db = newDb();
  let school: SeededSchool;
  let dir: string;
  let sectionId: string;
  beforeAll(async () => {
    school = await seedSchool(stamp('WAL'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-alerts-'));
    await withMigrator(async (c) => {
      const cls = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
        [school.id],
      );
      const sec = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
        [school.id, school.yearId, cls.rows[0]!.id],
      );
      sectionId = sec.rows[0]!.id;
      // four good weeks (95%) then a bad week (70%) of 30 pupils, one row per school day
      for (let back = 34; back >= 0; back -= 1) {
        const present = back >= 7 ? 29 : 21;
        await c.query(
          `INSERT INTO mart.attendance_daily (school_id, academic_year_id, on_date, class_section_id, class_id, section, strength, present, absent, late, marked)
           VALUES ($1, $2, CURRENT_DATE - $3::int, $4, $5, 'VI-A', 30, $6, $7, 0, true)`,
          [school.id, school.yearId, back, sectionId, cls.rows[0]!.id, present, 30 - present],
        );
      }
      // collections: ₹100,000 a week for four weeks, then ₹10,000
      for (let back = 34; back >= 0; back -= 7) {
        await c.query(
          `INSERT INTO mart.fee_collection_daily (school_id, academic_year_id, received_on, mode, receipts, amount)
           VALUES ($1, $2, CURRENT_DATE - $3::int, 'cash', 10, $4)`,
          [school.id, school.yearId, back, back >= 7 ? 100000 : 10000],
        );
      }
      const role = await c.query<{ id: string }>(
        "SELECT id::text FROM roles WHERE code = 'school_admin' AND school_id IS NULL",
      );
      await c.query(`UPDATE users SET mobile = '9876501234' WHERE id = $1`, [school.userId]);
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 'alerts test') ON CONFLICT DO NOTHING`,
        [school.id, school.userId, role.rows[0]!.id],
      );
    });
  });
  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('detects the attendance drop and the collection dip once, and queues the alert to the admins', async () => {
    const storage = createStorageDriver({ driver: 'local', localDir: dir, urlTtlSeconds: 60 });
    const run = () =>
      maintenanceProcessor({ db, storage, log, migratorUrl: undefined })({
        data: SYSTEM_ENVELOPE('insights.alerts'),
        attemptsMade: 0,
        opts: { attempts: 1 },
      });
    await run();
    const first = await withMigrator(async (c) => ({
      alerts: (
        await c.query(
          'SELECT kind, severity, subject_id::text, notified_at IS NOT NULL AS notified FROM insight_alerts WHERE school_id = $1 ORDER BY kind',
          [school.id],
        )
      ).rows,
      messages: (
        await c.query(
          "SELECT channel, recipient_address, body, status FROM comms_messages WHERE school_id = $1 AND body LIKE '%alert%' ORDER BY id",
          [school.id],
        )
      ).rows,
    }));
    expect(first.alerts).toEqual([
      { kind: 'attendance.drop', severity: 'danger', subject_id: sectionId, notified: true },
      { kind: 'fees.collection_dip', severity: 'warning', subject_id: null, notified: true },
    ]);
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0]).toMatchObject({
      channel: 'whatsapp',
      recipient_address: '9876501234',
      status: 'queued',
    });
    expect(String(first.messages[0]!.body)).toContain('Attendance drop in VI-A');
    // a second run the same day adds nothing and sends nothing
    await run();
    const second = await withMigrator(async (c) => ({
      alerts: Number(
        (await c.query('SELECT count(*) FROM insight_alerts WHERE school_id = $1', [school.id]))
          .rows[0]!.count,
      ),
      messages: Number(
        (
          await c.query(
            "SELECT count(*) FROM comms_messages WHERE school_id = $1 AND body LIKE '%alert%'",
            [school.id],
          )
        ).rows[0]!.count,
      ),
    }));
    expect(second).toEqual({ alerts: 2, messages: 2 });
  });
});
