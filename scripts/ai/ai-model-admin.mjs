#!/usr/bin/env node
/**
 * Mobilise gives (or takes away) the right "AI model for all schools" (platform.ai_model.manage, docs/design/101): who
 * may set the LLM every school uses — its address, token and test — on School settings → AI model. The right is in no
 * role and a school's own admin cannot give it; after this first grant its holders may pass it on. Runs as the
 * database owner. Usage, from the repo root with the .env loaded:
 *   node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE>                       who holds it in that school
 *   node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> <sub|e-mail|mobile>   gives it to that member of the school
 *   node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> <sub|e-mail|mobile> remove
 * The person's cached rights are cleared (Redis, REDIS_URL), so the right shows on their next page; without Redis it
 * shows within 5 minutes.
 */
import { createRequire } from 'node:module';

// the database driver of packages/db (the repo root has none of its own)
const require = createRequire(new URL('../../packages/db/package.json', import.meta.url));
const pg = require('pg');

const RIGHT = 'platform.ai_model.manage';
const ROLE = 'ai_model_admin';
const [code, who, action] = process.argv.slice(2);
if (!code || !/^[A-Za-z0-9_-]{2,40}$/.test(code) || (action !== undefined && action !== 'remove')) {
  console.error(
    'Usage: node scripts/ai/ai-model-admin.mjs <SCHOOL_CODE> [<sub|e-mail|mobile> [remove]]',
  );
  process.exit(2);
}
if (who !== undefined && !/^[A-Za-z0-9@._:+-]{3,120}$/.test(who)) {
  console.error('The person: their sign-in id (sub), e-mail or mobile.');
  process.exit(2);
}
const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error('DATABASE_MIGRATOR_URL is not set: load the .env first.');
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const school = (await c.query('SELECT id, code, name FROM schools WHERE code = $1', [code]))
    .rows[0];
  if (!school) throw new Error(`No school with the code ${code}`);
  if (who !== undefined) {
    const user = (
      await c.query(
        `SELECT u.id, u.display_name FROM users u
          WHERE u.deleted_at IS NULL AND (u.oneauth_sub = $1 OR u.email = $1 OR u.mobile = $1)
            AND EXISTS (SELECT 1 FROM user_school_memberships m WHERE m.user_id = u.id AND m.school_id = $2
                          AND m.status = 'active' AND m.deleted_at IS NULL)
          LIMIT 2`,
        [who, school.id],
      )
    ).rows;
    if (user.length !== 1)
      throw new Error(
        user.length
          ? 'More than one person matches: use their sign-in id'
          : `No active member of ${code} matches`,
      );
    await c.query('BEGIN');
    // the role in that school, carrying the right alone
    const role = (
      await c.query(
        `INSERT INTO roles (school_id, code, name, kind, is_system, description)
         VALUES ($1, $2, 'AI model for all schools', 'module', false,
                 'Sets the AI model (LLM) every school uses. Given by Mobilise; only its holders pass it on.')
         ON CONFLICT (school_id, code) DO UPDATE SET status = 'active', deleted_at = NULL
         RETURNING id`,
        [school.id, ROLE],
      )
    ).rows[0];
    if (!role) throw new Error('The role could not be made');
    await c.query(
      'INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [role.id, RIGHT],
    );
    if (action === 'remove') {
      await c.query(
        `UPDATE user_roles SET revoked_at = now(), updated_at = now()
          WHERE school_id = $1 AND user_id = $2 AND role_id = $3 AND revoked_at IS NULL`,
        [school.id, user[0].id, role.id],
      );
    } else {
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, $3, 'Mobilise: ai-model-admin script'
          WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $2 AND role_id = $3 AND revoked_at IS NULL)`,
        [school.id, user[0].id, role.id],
      );
    }
    await c.query('COMMIT');
    console.log(
      `${action === 'remove' ? 'Taken from' : 'Given to'} ${user[0].display_name} in ${school.code}.`,
    );
    // the API keeps a person's rights for 5 minutes (perm:<school>:<user>): cleared so it shows at once
    if (process.env.REDIS_URL) {
      try {
        const IORedis = createRequire(new URL('../../apps/api/package.json', import.meta.url))(
          'ioredis',
        );
        const redis = new IORedis(process.env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
        await redis.connect();
        await redis.del(`perm:${String(school.id)}:${String(user[0].id)}`);
        await redis.quit();
      } catch {
        console.log('(The cached rights could not be cleared: the change shows within 5 minutes.)');
      }
    }
  }
  const holders = (
    await c.query(
      `SELECT DISTINCT u.display_name FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission_code = $2
         JOIN users u ON u.id = ur.user_id
        WHERE ur.school_id = $1 AND ur.revoked_at IS NULL AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
        ORDER BY 1`,
      [school.id, RIGHT],
    )
  ).rows.map((r) => r.display_name);
  console.log(
    `${school.code}: AI model for all schools — ${holders.length ? holders.join(', ') : 'nobody'}`,
  );
} catch (e) {
  await c.query('ROLLBACK').catch(() => undefined);
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await c.end();
}
