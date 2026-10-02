import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorageDriver } from '@edupro/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintenanceProcessor, SYSTEM_ENVELOPE } from '../src/processors/maintenance';
import { log, newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

/** Sprint 22: the morning hypercare digest to the school admins. */
describe('maintenance: hypercare digest (Sprint 22)', () => {
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

  beforeAll(async () => {
    school = await seedSchool(stamp('WS22'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-s22-'));
    await withMigrator(async (c) => {
      const role = await c.query<{ id: string }>(
        "SELECT id::text FROM roles WHERE code = 'school_admin' AND school_id IS NULL",
      );
      await c.query(`UPDATE users SET mobile = '9876522099' WHERE id = $1`, [school.userId]);
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 's22 test') ON CONFLICT DO NOTHING`,
        [school.id, school.userId, role.rows[0]!.id],
      );
      await c.query(
        // hypercare issues are tickets to the ERP provider (helpdesk 0056)
        `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, category_code, raised_by_user_id, subject, body, desk, module, priority, provider_status, status, due_at)
         SELECT $1, (SELECT id FROM academic_years WHERE school_id = $1 ORDER BY start_date DESC LIMIT 1), x.number, 'query', 'bug', $2, x.title, x.title, 'provider', x.module, x.priority, x.pstatus, x.status::query_status, now() + x.due
           FROM (VALUES ('HC/001', 'Cashier print fails', 'fees', 'urgent', 'in_progress', 'in_progress', interval '-1 hour'),
                        ('HC/002', 'Typo on the notice screen', 'academics', 'low', 'open', 'open', interval '5 days'),
                        ('HC/003', 'Already closed', 'exams', 'high', 'closed', 'closed', interval '-2 days')) AS x(number, title, module, priority, pstatus, status, due)`,
        [school.id, school.userId],
      );
    });
  });
  afterAll(async () => {
    await withMigrator(async (c) => {
      await c.query(
        `DELETE FROM comms_messages WHERE school_id = $1 AND subject = 'Hypercare digest'`,
        [school.id],
      );
      await c
        .query(`DELETE FROM jobs_outbox WHERE payload->>'schoolId' = $1`, [school.id])
        .catch(() => undefined);
      await c.query(`DELETE FROM parent_queries WHERE school_id = $1 AND desk = 'provider'`, [
        school.id,
      ]);
    });
    await rm(dir, { recursive: true, force: true });
    await db.close();
  });

  it('sends one WhatsApp per admin with the open counts and the overdue list', async () => {
    await run('hypercare.digest');
    const msgs = await withMigrator((c) =>
      c.query<{ body: string; recipient_address: string }>(
        `SELECT body, recipient_address FROM comms_messages WHERE school_id = $1 AND subject = 'Hypercare digest'`,
        [school.id],
      ),
    );
    expect(msgs.rows.length).toBe(1);
    expect(msgs.rows[0]!.recipient_address).toBe('9876522099');
    expect(msgs.rows[0]!.body).toContain('S1 1 (1 overdue)');
    expect(msgs.rows[0]!.body).toContain('S4 1 (0 overdue)');
    expect(msgs.rows[0]!.body).toContain('HC/001 Cashier print fails');
    expect(msgs.rows[0]!.body).not.toContain('HC/003');
  });

  it('stays silent after platform.hypercare_until', async () => {
    await withMigrator((c) =>
      c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from) VALUES ($1, 'platform.hypercare_until', '"2020-01-01"'::jsonb, CURRENT_DATE)`,
        [school.id],
      ),
    );
    await run('hypercare.digest');
    const msgs = await withMigrator((c) =>
      c.query(
        `SELECT 1 FROM comms_messages WHERE school_id = $1 AND subject = 'Hypercare digest'`,
        [school.id],
      ),
    );
    expect(msgs.rowCount).toBe(1);
  });
});
