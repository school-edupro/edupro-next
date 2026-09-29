import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorageDriver } from '@edupro/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintenanceProcessor, SYSTEM_ENVELOPE } from '../src/processors/maintenance';
import { renderDsrAccess } from '../src/renderers/dsr-access';
import { log, newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/** Sprint 20: the retention purge (DPDP storage limitation) and the access report renderer. */
describe('maintenance: retention purge and the DSR access report (Sprint 20)', () => {
  const db = newDb();
  let school: SeededSchool;
  let dir: string;
  let studentId: string;
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

  beforeAll(async () => {
    school = await seedSchool(stamp('WS20'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-s20-'));
    await withMigrator(async (c) => {
      // old and recent rows for each policy
      await c.query(
        `INSERT INTO comms_messages (school_id, channel, recipient_address, body, status, created_at)
         VALUES ($1, 'sms', '9876500001', 'Old fee reminder with a name in it', 'sent', now() - interval '400 days'),
                ($1, 'sms', '9876500001', 'Recent notice', 'sent', now() - interval '2 days')`,
        [school.id],
      );
      await c.query(
        `INSERT INTO login_events (user_id, school_id, occurred_at, method, outcome)
         VALUES ($1, $2, now() - interval '400 days', 'compat', 'success'), ($1, $2, now() - interval '1 day', 'compat', 'success')`,
        [school.userId, school.id],
      );
      await c.query(
        `INSERT INTO visitor_log (school_id, visitor_name, purpose, in_at, out_at)
         VALUES ($1, 'Old Visitor', 'Old purpose', now() - interval '400 days', now() - interval '400 days'),
                ($1, 'New Visitor', 'New purpose', now() - interval '1 hour', NULL)`,
        [school.id],
      );
      const s = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, gender, status)
         VALUES ($1, 'WS20-1', 'Priya', 'Twenty', 'female', 'active') RETURNING id::text`,
        [school.id],
      );
      studentId = s.rows[0]!.id;
      await c.query(
        `INSERT INTO data_subject_requests (school_id, kind, principal_kind, principal_id, requested_by_user, channel, detail, due_on)
         VALUES ($1, 'access', 'student', $2, $3, 'office', 'test', CURRENT_DATE + 30)`,
        [school.id, studentId, school.userId],
      );
    });
  });
  afterAll(async () => {
    await withMigrator(async (c) => {
      await c.query(`DELETE FROM retention_runs WHERE school_id = $1`, [school.id]);
      await c.query(`DELETE FROM data_subject_requests WHERE school_id = $1`, [school.id]);
    });
    await rm(dir, { recursive: true, force: true });
    await db.close();
  });

  it('purges per policy from the settings and records one retention_runs row per policy', async () => {
    await run('retention.purge');
    const after = await withMigrator(async (c) => ({
      comms: (
        await c.query<{ body: string }>(
          `SELECT body FROM comms_messages WHERE school_id = $1 ORDER BY created_at`,
          [school.id],
        )
      ).rows.map((r) => r.body),
      logins: Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM login_events WHERE school_id = $1`,
            [school.id],
          )
        ).rows[0]!.n,
      ),
      visitors: (
        await c.query<{ visitor_name: string }>(
          `SELECT visitor_name FROM visitor_log WHERE school_id = $1`,
          [school.id],
        )
      ).rows.map((r) => r.visitor_name),
      runs: (
        await c.query<{ policy: string; keep_days: number; affected: number }>(
          `SELECT policy, keep_days, affected FROM retention_runs WHERE school_id = $1 ORDER BY policy`,
          [school.id],
        )
      ).rows,
    }));
    expect(after.comms).toEqual(['[retained metadata]', 'Recent notice']);
    expect(after.logins).toBe(1);
    expect(after.visitors).toEqual(['New Visitor']);
    expect(after.runs.map((r) => r.policy)).toEqual([
      'ai_messages',
      'comms_body',
      'login_events',
      'visitor_log',
    ]);
    expect(after.runs.find((r) => r.policy === 'comms_body')).toMatchObject({
      keep_days: 180,
      affected: 1,
    });
    expect(after.runs.find((r) => r.policy === 'visitor_log')).toMatchObject({
      keep_days: 365,
      affected: 1,
    });
  });

  it('renders the access report with every section for a pupil', async () => {
    const req = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM data_subject_requests WHERE school_id = $1 AND principal_id = $2`,
        [school.id, studentId],
      ),
    );
    const doc = await renderDsrAccess(
      db,
      {
        schoolId: school.id,
        userId: school.userId,
        requestId: null,
        kind: 'export.generate',
        payload: {},
      },
      { requestId: req.rows[0]!.id },
    );
    expect(doc.html).toContain('Personal data report');
    expect(doc.html).toContain('Priya Twenty');
    for (const section of [
      'Identity',
      'Guardians on record',
      'Enrolments',
      'Fees (demand, paid, balance)',
      'Consents (history)',
      'Files held',
    ])
      expect(doc.html).toContain(section);
    expect(doc.width).toBe('210mm');
  });
});
