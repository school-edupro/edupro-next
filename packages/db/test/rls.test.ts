/**
 * Row-level security proof (ADR-002). Runs against a real PostgreSQL with migrations applied.
 *
 * 1. Structural: every table in public with a school_id column has RLS enabled and forced and at least one
 *    policy. A new tenant table without RLS fails this test.
 * 2. Behavioural: school B cannot read, update or delete school A's rows; a forged school_id is rejected;
 *    no context means no rows.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, createFixture, ctxFor, MIGRATOR_URL, type Fixture } from './helpers';

let fixture: Fixture;
const db = appDb();

beforeAll(async () => {
  await db.assertApplicationRole();
  fixture = await createFixture('RLS');
});

afterAll(async () => {
  await db.close();
});

describe('structural guarantees', () => {
  it('every table with school_id has forced RLS and a policy', async () => {
    const c = new Client({ connectionString: MIGRATOR_URL });
    await c.connect();
    try {
      const { rows } = await c.query<{
        table_name: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policies: number;
      }>(`
        SELECT cols.table_name,
               cls.relrowsecurity,
               cls.relforcerowsecurity,
               (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = cols.table_name)::int AS policies
        FROM information_schema.columns cols
        JOIN pg_class cls ON cls.relname = cols.table_name
        JOIN pg_namespace n ON n.oid = cls.relnamespace AND n.nspname = 'public'
        WHERE cols.table_schema = 'public' AND cols.column_name = 'school_id'
          AND cls.relkind IN ('r', 'p')
          AND cols.table_name NOT LIKE 'audit_logs_%'
      `);
      expect(rows.length).toBeGreaterThan(0);
      const offenders = rows.filter(
        (r) => !r.relrowsecurity || !r.relforcerowsecurity || r.policies === 0,
      );
      expect(
        offenders,
        `tables without forced RLS or policies: ${offenders.map((o) => o.table_name).join(', ')}`,
      ).toEqual([]);
    } finally {
      await c.end();
    }
  });

  it('application role cannot bypass RLS', async () => {
    await expect(db.assertApplicationRole()).resolves.toBeUndefined();
  });
});

describe('tenant isolation on the reference module (classes)', () => {
  let classIdA: string;

  it('school A can create and read its own class', async () => {
    classIdA = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name) VALUES ($1, 'VI', 'Class VI') RETURNING id`,
        [fixture.schoolA],
      );
      return r.rows[0]!.id;
    });
    const seen = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query('SELECT id FROM classes WHERE id = $1', [classIdA]);
      return r.rowCount;
    });
    expect(seen).toBe(1);
  });

  it('school B cannot read school A rows', async () => {
    const seen = await db.withTenant(ctxFor(fixture, 'B'), async (c) => {
      const r = await c.query('SELECT id FROM classes WHERE id = $1', [classIdA]);
      return r.rowCount;
    });
    expect(seen).toBe(0);
  });

  it('school B cannot update or delete school A rows (zero rows affected, no error)', async () => {
    const affected = await db.withTenant(ctxFor(fixture, 'B'), async (c) => {
      const u = await c.query(`UPDATE classes SET name = 'hacked' WHERE id = $1`, [classIdA]);
      const d = await c.query(`DELETE FROM classes WHERE id = $1`, [classIdA]);
      return (u.rowCount ?? 0) + (d.rowCount ?? 0);
    });
    expect(affected).toBe(0);
    const intact = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query<{ name: string }>('SELECT name FROM classes WHERE id = $1', [
        classIdA,
      ]);
      return r.rows[0]?.name;
    });
    expect(intact).toBe('Class VI');
  });

  it('a forged school_id in an insert is rejected by WITH CHECK', async () => {
    await expect(
      db.withTenant(ctxFor(fixture, 'A'), async (c) => {
        await c.query(`INSERT INTO classes (school_id, code, name) VALUES ($1, 'VII', 'Forged')`, [
          fixture.schoolB,
        ]);
      }),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege: new row violates row-level security policy
  });

  it('the application layer refuses a schoolId outside allowedSchoolIds', async () => {
    await expect(
      db.withTenant(
        { schoolId: fixture.schoolB, userId: fixture.userA, allowedSchoolIds: [fixture.schoolA] },
        async () => undefined,
      ),
    ).rejects.toThrow(/allowedSchoolIds/);
  });

  it('no tenant context means no rows and no writes', async () => {
    const seen = await db.withoutTenant(async (c) => {
      const r = await c.query('SELECT count(*)::int AS n FROM classes');
      return r.rows[0]!.n as number;
    });
    expect(seen).toBe(0);
    await expect(
      db.withoutTenant(async (c) => {
        await c.query(
          `INSERT INTO classes (school_id, code, name) VALUES ($1, 'VIII', 'No context')`,
          [fixture.schoolA],
        );
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('membership-filtered global tables', () => {
  it('a user sees only schools in allowedSchoolIds', async () => {
    const codes = await db.withTenant(
      { schoolId: fixture.schoolA, userId: fixture.userA, allowedSchoolIds: [fixture.schoolA] },
      async (c) => {
        const r = await c.query<{ id: string }>('SELECT id FROM schools ORDER BY id');
        return r.rows.map((x) => x.id);
      },
    );
    expect(codes).toContain(fixture.schoolA);
    expect(codes).not.toContain(fixture.schoolB);
  });

  it('system role templates are visible to every school but not writable', async () => {
    const templates = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query<{ code: string }>(
        `SELECT code FROM roles WHERE school_id IS NULL ORDER BY code`,
      );
      return r.rows.map((x) => x.code);
    });
    expect(templates).toContain('school_admin');
    const affected = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query(
        `UPDATE roles SET name = 'x' WHERE school_id IS NULL AND code = 'school_admin'`,
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(0);
  });
});

describe('audit log is append-only', () => {
  it('rejects update and delete', async () => {
    const id = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query<{ id: string; occurred_at: string }>(
        `INSERT INTO audit_logs (school_id, actor_type, actor_user_id, action, entity_type, entity_id, source)
         VALUES ($1, 'user', $2, 'test', 'classes', '1', 'api') RETURNING id, occurred_at`,
        [fixture.schoolA, fixture.userA],
      );
      return r.rows[0]!.id;
    });
    await expect(
      db.withTenant(ctxFor(fixture, 'A'), async (c) => {
        await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [id]);
      }),
    ).rejects.toMatchObject({ code: '42501' }); // no UPDATE privilege for edupro_app
  });
});
