import { Client } from 'pg';
import { Db, type TenantContext } from '@edupro/db';
import { createLogger } from '../src/logger';

export const MIGRATOR_URL =
  process.env.DATABASE_MIGRATOR_URL ??
  'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';
export const APP_URL =
  process.env.DATABASE_URL ?? 'postgresql://edupro_app:edupro_app_dev@localhost:5432/edupro';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const log = createLogger('silent');

export async function withMigrator<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const stamp = (prefix: string): string =>
  `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;

export interface SeededSchool {
  id: string;
  yearId: string;
  userId: string;
}

export async function seedSchool(code: string): Promise<SeededSchool> {
  return withMigrator(async (c) => {
    const s = await c.query<{ id: string }>(
      'INSERT INTO schools (code, name, short_name) VALUES ($1, $1, $1) RETURNING id::text',
      [code],
    );
    const id = s.rows[0]!.id;
    const y = await c.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
       VALUES ($1, '2026-27', 'Session 2026-27', '2026-04-01', '2027-03-31', 'active') RETURNING id::text`,
      [id],
    );
    await c.query(
      `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status) VALUES ($1, 'FY2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active')`,
      [id],
    );
    const u = await c.query<{ id: string }>(
      'INSERT INTO users (oneauth_sub, display_name, mobile, email) VALUES ($1, $1, $2, $3) RETURNING id::text',
      [
        `${code}-user`,
        `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
        `${code.toLowerCase()}@example.test`,
      ],
    );
    await c.query(
      'INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, $3::person_type)',
      [id, u.rows[0]!.id, 'employee'],
    );
    return { id, yearId: y.rows[0]!.id, userId: u.rows[0]!.id };
  });
}

export const tenantOf = (s: SeededSchool): TenantContext => ({
  schoolId: s.id,
  userId: s.userId,
  allowedSchoolIds: [s.id],
  academicYearId: s.yearId,
});

export const newDb = (): Db => new Db({ connectionString: APP_URL });
