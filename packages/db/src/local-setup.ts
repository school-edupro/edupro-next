/**
 * Local cluster bootstrap for machines without psql or Docker: creates the `edupro` database if missing and
 * runs init/01_roles.sql. Connects as the cluster superuser (edupro_migrator) to the maintenance database.
 *
 * Usage: DATABASE_MIGRATOR_URL=postgresql://edupro_migrator:...@localhost:5432/edupro tsx src/local-setup.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, '') || 'edupro';

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new Client({ connectionString: admin.href, application_name: 'edupro-local-setup' });
  await c.connect();
  try {
    const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}" ENCODING 'UTF8'`);
      process.stdout.write(`created database ${dbName}\n`);
    } else {
      process.stdout.write(`database ${dbName} already exists\n`);
    }
    const rolesSql = await readFile(join(__dirname, '..', 'init', '01_roles.sql'), 'utf8');
    await c.query(rolesSql);
    process.stdout.write('application roles ensured (edupro_app, edupro_readonly)\n');
  } finally {
    await c.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
