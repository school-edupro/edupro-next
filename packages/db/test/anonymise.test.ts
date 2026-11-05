import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymise, assertAnonymiseAllowed } from '../src/anonymise';
import { migrate } from '../src/migrate';
import { MIGRATOR_URL } from './helpers';

/**
 * anonymise() rewrites every row of the tables it covers. Over the shared dev database that is about a
 * million rows, nearly all from retired test schools, and it outgrew the test timeout. So the run here
 * gets a small database of its own: freshly migrated, one school, dropped afterwards.
 */
const SCRATCH_DB = `edupro_anon_test_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

function urlFor(db: string): string {
  const url = new URL(MIGRATOR_URL);
  url.pathname = `/${db}`;
  return url.toString();
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function onServer(fn: (c: Client) => Promise<unknown>): Promise<void> {
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    await fn(c);
  } finally {
    await c.end();
  }
}

describe('staging anonymisation (S5-06)', () => {
  let schoolId: string;
  let c: Client;
  beforeAll(async () => {
    await onServer(async (s) => {
      // Left behind by an interrupted run. One still in use (another run) refuses the drop and stays.
      const left = await s.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datname LIKE 'edupro\\_anon\\_test\\_%'",
      );
      for (const { datname } of left.rows)
        await s.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)}`).catch(() => undefined);
      await s.query(`CREATE DATABASE ${quoteIdent(SCRATCH_DB)}`);
    });
    await migrate(urlFor(SCRATCH_DB), () => undefined);
    c = new Client({ connectionString: urlFor(SCRATCH_DB) });
    await c.connect();
    const school = await c.query<{ id: string }>(
      "INSERT INTO schools (code, name, short_name) VALUES ('ANON', 'Anon School', 'Anon') RETURNING id",
    );
    schoolId = school.rows[0]!.id;
    await c.query(
      `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, address) VALUES ($1, 'A1', 'Real', 'Name', '2015-06-14', '{"line1":"12 Real Street"}')`,
      [schoolId],
    );
    await c.query(
      `INSERT INTO guardians (school_id, first_name, mobile, email) VALUES ($1, 'Real Parent', '9876543210', 'real@example.com')`,
      [schoolId],
    );
  }, 120_000);
  afterAll(async () => {
    await c?.end();
    await onServer((s) =>
      s.query(`DROP DATABASE IF EXISTS ${quoteIdent(SCRATCH_DB)} WITH (FORCE)`),
    );
  });

  it('refuses without the flag or on a production-looking database name', () => {
    expect(() =>
      assertAnonymiseAllowed('postgresql://x@h/edupro', { ALLOW_ANONYMISE: '1' }),
    ).toThrow(/refusing/);
    expect(() => assertAnonymiseAllowed('postgresql://x@h/edupro_staging', {})).toThrow(
      /ALLOW_ANONYMISE/,
    );
    expect(() =>
      assertAnonymiseAllowed('postgresql://x@h/edupro_staging', { ALLOW_ANONYMISE: '1' }),
    ).not.toThrow();
  });

  it('replaces personal values and keeps structure (rolled back here)', async () => {
    await c.query('BEGIN');
    try {
      const rows = await anonymise(c);
      expect(rows).toBeGreaterThan(0);
      const s = await c.query(
        'SELECT first_name, last_name, dob::text, address FROM students WHERE school_id = $1',
        [schoolId],
      );
      expect(s.rows[0]).toMatchObject({ first_name: 'Student', dob: '2015-01-01', address: {} });
      expect(s.rows[0].last_name).toMatch(/^S\d+$/);
      const g = await c.query('SELECT mobile, email FROM guardians WHERE school_id = $1', [
        schoolId,
      ]);
      expect(g.rows[0].mobile).toMatch(/^9\d{9}$/);
      expect(g.rows[0].mobile).not.toBe('9876543210');
      expect(g.rows[0].email).toMatch(/@example\.test$/);
      const real = await c.query(
        "SELECT count(*)::int AS n FROM guardians WHERE email LIKE '%example.com'",
      );
      expect(real.rows[0].n).toBe(0);
    } finally {
      await c.query('ROLLBACK');
    }
  });
});
