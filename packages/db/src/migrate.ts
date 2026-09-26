/**
 * Plain-SQL migration runner. Applies packages/db/migrations/*.sql in lexical order, each inside its own
 * transaction, recording name and checksum in app.schema_migrations. Re-running is a no-op. A changed
 * checksum for an applied file fails loudly: applied migrations are immutable (ADR-006).
 *
 * Usage: DATABASE_MIGRATOR_URL=postgresql://... tsx src/migrate.ts
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');

  const client = new Client({ connectionString: url, application_name: 'edupro-migrate' });
  await client.connect();

  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // Serialise concurrent runners (two CI jobs, two pods) on one advisory lock.
    await client.query('SELECT pg_advisory_lock(727001)');

    const applied = new Map<string, string>();
    for (const row of (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM app.schema_migrations')).rows) {
      applied.set(row.name, row.checksum);
    }

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = applied.get(file);

      if (existing) {
        if (existing !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead.`);
        }
        continue;
      }

      process.stdout.write(`applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        process.stdout.write('ok\n');
      } catch (error) {
        await client.query('ROLLBACK');
        process.stdout.write('failed\n');
        throw error;
      }
    }

    await client.query('SELECT pg_advisory_unlock(727001)');
    process.stdout.write(`migrations up to date (${files.length} files)\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
