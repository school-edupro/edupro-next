import { Client } from 'pg';
import { Db } from '../src/index';

export const MIGRATOR_URL =
  process.env.DATABASE_MIGRATOR_URL ?? 'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';
export const APP_URL =
  process.env.DATABASE_URL ?? 'postgresql://edupro_app:edupro_app_dev@localhost:5432/edupro';

export interface Fixture {
  schoolA: string;
  schoolB: string;
  yearA: string;
  yearB: string;
  fyA: string;
  fyB: string;
  userA: string;
  userB: string;
}

/** Creates two isolated schools with one active year each, using the migrator connection. */
export async function createFixture(prefix = 'T'): Promise<Fixture> {
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    const stamp = `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
    const ids = async (code: string, name: string) => {
      const s = await c.query<{ id: string }>(
        `INSERT INTO schools (code, name, short_name) VALUES ($1, $2, $2) RETURNING id`,
        [code, name],
      );
      const schoolId = s.rows[0]!.id;
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2026-27', 'Session 2026-27', '2026-04-01', '2027-03-31', 'active') RETURNING id`,
        [schoolId],
      );
      const f = await c.query<{ id: string }>(
        `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, 'FY2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active') RETURNING id`,
        [schoolId],
      );
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, display_name) VALUES ($1, $2) RETURNING id`,
        [`${code}-user`, `${name} User`],
      );
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, 'employee')`,
        [schoolId, u.rows[0]!.id],
      );
      return { schoolId, yearId: y.rows[0]!.id, fyId: f.rows[0]!.id, userId: u.rows[0]!.id };
    };
    const a = await ids(`${stamp}A`, `${stamp} School A`);
    const b = await ids(`${stamp}B`, `${stamp} School B`);
    return {
      schoolA: a.schoolId,
      schoolB: b.schoolId,
      yearA: a.yearId,
      yearB: b.yearId,
      fyA: a.fyId,
      fyB: b.fyId,
      userA: a.userId,
      userB: b.userId,
    };
  } finally {
    await c.end();
  }
}

export function appDb(): Db {
  return new Db({ connectionString: APP_URL, pool: { max: 10 } });
}

export function ctxFor(f: Fixture, which: 'A' | 'B') {
  return which === 'A'
    ? { schoolId: f.schoolA, userId: f.userA, allowedSchoolIds: [f.schoolA], academicYearId: f.yearA }
    : { schoolId: f.schoolB, userId: f.userB, allowedSchoolIds: [f.schoolB], academicYearId: f.yearB };
}
