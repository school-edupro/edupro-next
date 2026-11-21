#!/usr/bin/env node
/**
 * Mobilise sets a school's monthly limit of Claude answers (docs/design/93). The school's own screens never change it;
 * this runs as the database owner. Usage, from the repo root with the .env loaded:
 *   node scripts/ai/claude-limit.mjs <SCHOOL_CODE>              shows the limit and this month's use
 *   node scripts/ai/claude-limit.mjs <SCHOOL_CODE> <number>     sets it (0 switches Claude off for the school)
 *   node scripts/ai/claude-limit.mjs <SCHOOL_CODE> default      back to AI_CLAUDE_MONTHLY_QUESTIONS
 */
import { createRequire } from 'node:module';

// the database driver of packages/db (the repo root has none of its own)
const require = createRequire(new URL('../../packages/db/package.json', import.meta.url));
const pg = require('pg');

const [code, value] = process.argv.slice(2);
if (!code || !/^[A-Za-z0-9_-]{2,40}$/.test(code)) {
  console.error('Usage: node scripts/ai/claude-limit.mjs <SCHOOL_CODE> [number|default]');
  process.exit(2);
}
if (value !== undefined && value !== 'default' && !/^\d{1,7}$/.test(value)) {
  console.error('The limit is a whole number (0 to 1000000) or "default".');
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
  if (value !== undefined) {
    const limit = value === 'default' ? null : Number(value);
    await c.query(
      `INSERT INTO assistant_settings (school_id, claude_monthly_limit) VALUES ($1, $2)
       ON CONFLICT (school_id) DO UPDATE SET claude_monthly_limit = EXCLUDED.claude_monthly_limit`,
      [school.id, limit],
    );
  }
  const row = (
    await c.query(
      `SELECT s.claude_monthly_limit AS "limit", s.claude,
              (SELECT count(*)::int FROM ai_audit a WHERE a.school_id = $1 AND a.provider = 'claude' AND a.kind = 'prompt'
                  AND a.at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')) AS used
         FROM assistant_settings s WHERE s.school_id = $1`,
      [school.id],
    )
  ).rows[0];
  const fallback = Number(process.env.AI_CLAUDE_MONTHLY_QUESTIONS ?? 500);
  console.log(
    `${school.code}: limit ${row?.limit ?? `${fallback} (the default)`}, used this month ${row?.used ?? 0}, ` +
      `on for ${
        Object.entries(row?.claude ?? {})
          .filter(([, on]) => on)
          .map(([a]) => a)
          .join(', ') || 'nobody yet'
      }`,
  );
} finally {
  await c.end();
}
