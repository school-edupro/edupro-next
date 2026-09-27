import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonymise, assertAnonymiseAllowed } from '../src/anonymise';
import { MIGRATOR_URL, createFixture, type Fixture } from './helpers';

describe('staging anonymisation (S5-06)', () => {
  let fixture: Fixture;
  let c: Client;
  beforeAll(async () => {
    fixture = await createFixture('ANON');
    c = new Client({ connectionString: MIGRATOR_URL });
    await c.connect();
    await c.query(
      `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, address) VALUES ($1, 'A1', 'Real', 'Name', '2015-06-14', '{"line1":"12 Real Street"}')`,
      [fixture.schoolA],
    );
    await c.query(
      `INSERT INTO guardians (school_id, first_name, mobile, email) VALUES ($1, 'Real Parent', '9876543210', 'real@example.com')`,
      [fixture.schoolA],
    );
  });
  afterAll(() => c.end());

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
        [fixture.schoolA],
      );
      expect(s.rows[0]).toMatchObject({ first_name: 'Student', dob: '2015-01-01', address: {} });
      expect(s.rows[0].last_name).toMatch(/^S\d+$/);
      const g = await c.query('SELECT mobile, email FROM guardians WHERE school_id = $1', [
        fixture.schoolA,
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
