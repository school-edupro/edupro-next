/**
 * Notes the last school id before the run: every e2e suite makes schools of its own, and once the run is
 * over global-teardown.cjs retires them, so they stop feeding the per-school background jobs.
 */
const { Client } = require('pg');

module.exports = async function globalSetup() {
  const c = new Client({
    connectionString:
      process.env.DATABASE_MIGRATOR_URL ??
      'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro',
  });
  await c.connect();
  try {
    const r = await c.query('SELECT COALESCE(max(id), 0)::text AS m FROM schools');
    globalThis.__EDUPRO_SCHOOLS_BEFORE__ = r.rows[0].m;
  } finally {
    await c.end();
  }
};
