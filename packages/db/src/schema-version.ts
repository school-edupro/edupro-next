import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * Schema-version check (S5-05): the application refuses to start when the database is not at the
 * migration this build ships with. Migration files are part of the package, so the expected version is
 * the last file name in packages/db/migrations at build time.
 */
export async function expectedSchemaVersion(
  migrationsDir = join(__dirname, '..', 'migrations'),
): Promise<string> {
  const files = (await readdir(migrationsDir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const last = files[files.length - 1];
  if (!last) throw new Error(`no migration files found in ${migrationsDir}`);
  return last;
}

export async function appliedSchemaVersion(pool: Pool): Promise<string | null> {
  const r = await pool.query<{ name: string | null }>(
    'SELECT max(name) AS name FROM app.schema_migrations',
  );
  return r.rows[0]?.name ?? null;
}

export interface SchemaCheckResult {
  expected: string;
  applied: string | null;
  ok: boolean;
}

export async function checkSchemaVersion(
  pool: Pool,
  migrationsDir?: string,
): Promise<SchemaCheckResult> {
  const [expected, applied] = await Promise.all([
    expectedSchemaVersion(migrationsDir),
    appliedSchemaVersion(pool),
  ]);
  return { expected, applied, ok: expected === applied };
}
