/**
 * Development seed: one group, two schools, years, a dev admin user with memberships and the School Admin
 * template role in both schools. Runs as the migrator (bypasses RLS through the migrator policies).
 * Never run against staging or production.
 *
 * Usage: DATABASE_MIGRATOR_URL=postgresql://... tsx src/seed-dev.ts
 */
import { Client } from 'pg';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('seed-dev refuses to run in production');
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');

  const c = new Client({ connectionString: url, application_name: 'edupro-seed-dev' });
  await c.connect();
  try {
    await c.query('BEGIN');

    const group = await c.query<{ id: string }>(
      `INSERT INTO school_groups (code, name) VALUES ('DEVGRP', 'Development Group')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const groupId = group.rows[0]!.id;

    const schools: Array<{ code: string; name: string }> = [
      { code: 'ALPHA', name: 'Alpha Public School' },
      { code: 'BETA', name: 'Beta Public School' },
    ];
    const schoolIds: string[] = [];
    for (const s of schools) {
      const r = await c.query<{ id: string }>(
        `INSERT INTO schools (group_id, code, name, short_name, board)
         VALUES ($1, $2, $3, $3, 'CBSE')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [groupId, s.code, s.name],
      );
      const id = r.rows[0]!.id;
      schoolIds.push(id);

      await c.query(
        `INSERT INTO campuses (school_id, code, name) VALUES ($1, 'MAIN', 'Main Campus')
         ON CONFLICT (school_id, code) DO NOTHING`,
        [id],
      );
      await c.query(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2026-27', 'Session 2026-27', '2026-04-01', '2027-03-31', 'active')
         ON CONFLICT (school_id, code) DO NOTHING`,
        [id],
      );
      await c.query(
        `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, 'FY2026-27', 'Financial Year 2026-27', '2026-04-01', '2027-03-31', 'active')
         ON CONFLICT (school_id, code) DO NOTHING`,
        [id],
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value)
         SELECT $1, 'fees.late_fee_mode', '"daywise"'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE school_id = $1 AND key = 'fees.late_fee_mode')`,
        [id],
      );
    }

    const user = await c.query<{ id: string }>(
      `INSERT INTO users (oneauth_sub, email, mobile, display_name)
       VALUES ('dev-admin', 'dev-admin@example.test', '9999999999', 'Dev Admin')
       ON CONFLICT (oneauth_sub) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    );
    const userId = user.rows[0]!.id;

    const role = await c.query<{ id: string }>(
      `SELECT id FROM roles WHERE school_id IS NULL AND code = 'school_admin'`,
    );
    const roleId = role.rows[0]!.id;

    for (const schoolId of schoolIds) {
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type)
         VALUES ($1, $2, 'employee') ON CONFLICT (school_id, user_id, person_type) DO NOTHING`,
        [schoolId, userId],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, $3, 'dev seed'
         WHERE NOT EXISTS (
           SELECT 1 FROM user_roles WHERE school_id = $1 AND user_id = $2 AND role_id = $3 AND revoked_at IS NULL
         )`,
        [schoolId, userId, roleId],
      );
    }

    await c.query('COMMIT');
    process.stdout.write(
      `seeded schools ${schoolIds.join(', ')} and user dev-admin (id ${userId})\n`,
    );
    process.stdout.write('dev token for the API: Authorization: Bearer dev:dev-admin\n');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    await c.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
