import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorageDriver } from '@edupro/storage';
import { maintenanceProcessor, SYSTEM_ENVELOPE } from '../src/processors/maintenance';
import { log, newDb, seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

describe('maintenance: break-glass expiry (S5-03)', () => {
  const db = newDb();
  let school: SeededSchool;
  let dir: string;
  beforeAll(async () => {
    school = await seedSchool(stamp('WBG'));
    dir = await mkdtemp(join(tmpdir(), 'edupro-maint-'));
  });
  afterAll(async () => {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('revokes the expired grant, records the report and queues the email to the security lead', async () => {
    const { eventId, userRoleId } = await withMigrator(async (c) => {
      const role = await c.query<{ id: string }>(
        "SELECT id::text FROM roles WHERE code = 'school_admin' AND school_id IS NULL",
      );
      const ur = await c.query<{ id: string }>(
        `INSERT INTO user_roles (school_id, user_id, role_id, valid_from, valid_to, reason) VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, 'break-glass: test') RETURNING id::text`,
        [school.id, school.userId, role.rows[0]!.id],
      );
      const ev = await c.query<{ id: string }>(
        `INSERT INTO break_glass_events (school_id, user_id, role_id, user_role_id, reason, started_at, expires_at)
         VALUES ($1, $2, $3, $4, 'test window', now() - interval '3 hours', now() - interval '1 minute') RETURNING id::text`,
        [school.id, school.userId, role.rows[0]!.id, ur.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from) VALUES ($1, 'security.break_glass_email', '"lead@example.test"'::jsonb, CURRENT_DATE) ON CONFLICT DO NOTHING`,
        [school.id],
      );
      await c.query(
        `INSERT INTO audit_logs (school_id, actor_type, actor_user_id, action, entity_type, source, occurred_at) VALUES ($1, 'user', $2, 'platform.settings.edit', 'school_settings', 'api', now() - interval '2 hours')`,
        [school.id, school.userId],
      );
      return { eventId: ev.rows[0]!.id, userRoleId: ur.rows[0]!.id };
    });
    const storage = createStorageDriver({ driver: 'local', localDir: dir, urlTtlSeconds: 60 });
    await maintenanceProcessor({ db, storage, log, migratorUrl: undefined })({
      data: SYSTEM_ENVELOPE('break_glass.expire'),
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    const after = await withMigrator(async (c) => ({
      event: (
        await c.query('SELECT revoked_at, report_sent_at FROM break_glass_events WHERE id = $1', [
          eventId,
        ])
      ).rows[0],
      grant: (await c.query('SELECT revoked_at FROM user_roles WHERE id = $1', [userRoleId]))
        .rows[0],
      message: (
        await c.query(
          "SELECT recipient_address, subject, body FROM comms_messages WHERE school_id = $1 AND subject LIKE 'Break-glass report%'",
          [school.id],
        )
      ).rows[0],
      outbox: (
        await c.query(
          "SELECT count(*)::int AS n FROM jobs_outbox WHERE school_id = $1 AND queue = 'notifications' AND status = 'pending'",
          [school.id],
        )
      ).rows[0],
    }));
    expect(after.event.revoked_at).not.toBeNull();
    expect(after.event.report_sent_at).not.toBeNull();
    expect(after.grant.revoked_at).not.toBeNull();
    expect(after.message).toMatchObject({ recipient_address: 'lead@example.test' });
    expect(after.message.body).toContain('1 x platform.settings.edit');
    expect(after.outbox.n).toBeGreaterThanOrEqual(1);
  });
});
