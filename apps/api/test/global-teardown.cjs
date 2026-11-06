/**
 * Retires the schools this run made (newer than the id global-setup.cjs noted, named by their test code):
 * left active, thousands of them had the marts refresh and the other per-school jobs walk them all day.
 * Their queued messages are cancelled too (6 Nov 2026): some carry test keys under live providers'
 * names (smsbhejo, MSG91, FCM) and must never reach them when the workers run.
 */
const { Client } = require('pg');

module.exports = async function globalTeardown() {
  const before = globalThis.__EDUPRO_SCHOOLS_BEFORE__;
  if (!before) return;
  const c = new Client({
    connectionString:
      process.env.DATABASE_MIGRATOR_URL ??
      'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro',
  });
  await c.connect();
  try {
    await c.query(
      `WITH gone AS (
         UPDATE schools SET status = 'inactive', updated_at = now()
          WHERE id > $1::bigint AND name = code AND status = 'active'
         RETURNING id)
       UPDATE comms_messages SET status = 'cancelled', last_error = 'Not sent: a test school, retired after the run',
              updated_at = now()
        WHERE school_id IN (SELECT id FROM gone) AND status IN ('queued', 'sending')`,
      [before],
    );
  } finally {
    await c.end();
  }
};
