/**
 * Procedure tests (ADR-006): receipt numbering under concurrency, year guard behaviour.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, createFixture, ctxFor, MIGRATOR_URL, type Fixture } from './helpers';

let fixture: Fixture;
const db = appDb();

beforeAll(async () => {
  fixture = await createFixture('PRC');
});

afterAll(async () => {
  await db.close();
});

describe('app.next_receipt_no', () => {
  it('issues gap-free, unique numbers under concurrent transactions', async () => {
    const N = 25;
    const numbers = await Promise.all(
      Array.from({ length: N }, () =>
        db.withTenant(ctxFor(fixture, 'A'), async (c) => {
          const r = await c.query<{ no: string }>(`SELECT app.next_receipt_no('school', $1) AS no`, [fixture.fyA]);
          return r.rows[0]!.no;
        }),
      ),
    );
    expect(new Set(numbers).size).toBe(N);
    const suffixes = numbers.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
    expect(suffixes[0]).toBe(1);
    expect(suffixes[N - 1]).toBe(N);
    expect(numbers[0]!.startsWith('TF/FY2026-27/')).toBe(true);
  });

  it('keeps separate sequences per ledger and per school', async () => {
    const hostel = await db.withTenant(ctxFor(fixture, 'A'), async (c) => {
      const r = await c.query<{ no: string }>(`SELECT app.next_receipt_no('hostel', $1) AS no`, [fixture.fyA]);
      return r.rows[0]!.no;
    });
    expect(hostel).toBe('HF/FY2026-27/000001');

    const schoolB = await db.withTenant(ctxFor(fixture, 'B'), async (c) => {
      const r = await c.query<{ no: string }>(`SELECT app.next_receipt_no('school', $1) AS no`, [fixture.fyB]);
      return r.rows[0]!.no;
    });
    expect(schoolB).toBe('TF/FY2026-27/000001');
  });

  it('refuses a financial year of another school', async () => {
    await expect(
      db.withTenant(ctxFor(fixture, 'A'), async (c) => {
        await c.query(`SELECT app.next_receipt_no('school', $1)`, [fixture.fyB]);
      }),
    ).rejects.toMatchObject({ message: 'financial_year.not_found' });
  });

  it('refuses to run without tenant context', async () => {
    await expect(
      db.withoutTenant(async (c) => {
        await c.query(`SELECT app.next_receipt_no('school', $1)`, [fixture.fyA]);
      }),
    ).rejects.toMatchObject({ message: 'tenant.context_missing' });
  });
});

describe('app.assert_year_open', () => {
  it('passes for an active, unlocked year', async () => {
    await expect(
      db.withTenant(ctxFor(fixture, 'A'), async (c) => {
        await c.query(`SELECT app.assert_year_open($1, 'fees')`, [fixture.yearA]);
      }),
    ).resolves.toBeUndefined();
  });

  it('fails for a stage lock and for a closed year', async () => {
    const m = new Client({ connectionString: MIGRATOR_URL });
    await m.connect();
    try {
      await m.query(`UPDATE academic_years SET locks = '{"fees": true}'::jsonb WHERE id = $1`, [fixture.yearA]);
      await expect(
        db.withTenant(ctxFor(fixture, 'A'), async (c) => {
          await c.query(`SELECT app.assert_year_open($1, 'fees')`, [fixture.yearA]);
        }),
      ).rejects.toMatchObject({ message: 'year.stage_locked' });

      // Other stages are still open
      await expect(
        db.withTenant(ctxFor(fixture, 'A'), async (c) => {
          await c.query(`SELECT app.assert_year_open($1, 'academics')`, [fixture.yearA]);
        }),
      ).resolves.toBeUndefined();

      await m.query(`UPDATE academic_years SET status = 'closed' WHERE id = $1`, [fixture.yearA]);
      await expect(
        db.withTenant(ctxFor(fixture, 'A'), async (c) => {
          await c.query(`SELECT app.assert_year_open($1, 'academics')`, [fixture.yearA]);
        }),
      ).rejects.toMatchObject({ message: 'year.closed' });
    } finally {
      await m.query(`UPDATE academic_years SET status = 'active', locks = '{}'::jsonb WHERE id = $1`, [fixture.yearA]);
      await m.end();
    }
  });

  it('cannot see another school year (RLS inside the procedure)', async () => {
    await expect(
      db.withTenant(ctxFor(fixture, 'A'), async (c) => {
        await c.query(`SELECT app.assert_year_open($1, 'fees')`, [fixture.yearB]);
      }),
    ).rejects.toMatchObject({ message: 'year.not_found' });
  });
});

describe('app.audit_row_change trigger', () => {
  it('writes before and after images with actor and request id', async () => {
    const m = new Client({ connectionString: MIGRATOR_URL });
    await m.connect();
    try {
      await m.query(`
        CREATE TABLE IF NOT EXISTS audit_probe (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          school_id BIGINT NOT NULL REFERENCES schools(id),
          amount NUMERIC(12,2) NOT NULL,
          secret TEXT
        )`);
      await m.query(`CALL app.apply_tenant_rls('audit_probe')`);
      await m.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON audit_probe TO edupro_app`);
      await m.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edupro_app`);
      await m.query(`
        DROP TRIGGER IF EXISTS audit_probe_audit ON audit_probe;
        CREATE TRIGGER audit_probe_audit AFTER INSERT OR UPDATE OR DELETE ON audit_probe
          FOR EACH ROW EXECUTE FUNCTION app.audit_row_change('secret')`);
    } finally {
      await m.end();
    }

    const requestId = '11111111-2222-4333-8444-555555555555';
    const rows = await db.withTenant({ ...ctxFor(fixture, 'A'), requestId }, async (c) => {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO audit_probe (school_id, amount, secret) VALUES ($1, 100.00, 'pan-1234') RETURNING id`,
        [fixture.schoolA],
      );
      await c.query(`UPDATE audit_probe SET amount = 150.00 WHERE id = $1`, [ins.rows[0]!.id]);
      const a = await c.query(
        `SELECT action, actor_user_id::text AS actor, before, after, request_id
         FROM audit_logs WHERE entity_type = 'audit_probe' AND entity_id = $1 ORDER BY id`,
        [ins.rows[0]!.id],
      );
      return a.rows as Array<{ action: string; actor: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; request_id: string }>;
    });

    expect(rows.map((r) => r.action)).toEqual(['insert', 'update']);
    expect(rows[0]!.actor).toBe(fixture.userA);
    expect(rows[0]!.request_id).toBe(requestId);
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after?.secret).toBe('***'); // masked
    // to_jsonb(NUMERIC) yields a JSON number; node-postgres parses it as a JavaScript number
    expect(Number(rows[1]!.before?.amount)).toBe(100);
    expect(Number(rows[1]!.after?.amount)).toBe(150);
  });
});
