/**
 * Shared e2e fixtures: seeds schools, users and role assignments through the migrator connection, and
 * builds the Nest application with the production HTTP setup (app.setup.ts).
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';

export const MIGRATOR_URL =
  process.env.DATABASE_MIGRATOR_URL ??
  'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';

export interface SeededSchool {
  id: string;
  code: string;
  yearId: string;
  fyId: string;
}

export interface SeededUser {
  id: string;
  sub: string;
}

export async function withMigrator<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export function stamp(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
}

export async function seedSchool(c: Client, code: string): Promise<SeededSchool> {
  const s = await c.query<{ id: string }>(
    `INSERT INTO schools (code, name, short_name) VALUES ($1, $1, $1) RETURNING id::text`,
    [code],
  );
  const id = s.rows[0]!.id;
  const y = await c.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
     VALUES ($1, '2026-27', 'Session 2026-27', '2026-04-01', '2027-03-31', 'active') RETURNING id::text`,
    [id],
  );
  const f = await c.query<{ id: string }>(
    `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status)
     VALUES ($1, 'FY2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active') RETURNING id::text`,
    [id],
  );
  await c.query(`INSERT INTO campuses (school_id, code, name) VALUES ($1, 'MAIN', 'Main Campus')`, [
    id,
  ]);
  return { id, code, yearId: y.rows[0]!.id, fyId: f.rows[0]!.id };
}

/** Creates a user with a membership in the school and optionally a template role. */
export async function seedUser(
  c: Client,
  school: SeededSchool,
  sub: string,
  roleCode?: string,
  personType = 'employee',
): Promise<SeededUser> {
  const u = await c.query<{ id: string }>(
    `INSERT INTO users (oneauth_sub, display_name, mobile) VALUES ($1, $1, $2) RETURNING id::text`,
    [sub, `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`],
  );
  const id = u.rows[0]!.id;
  await c.query(
    `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, $3::person_type)`,
    [school.id, id, personType],
  );
  if (roleCode) {
    await c.query(
      `INSERT INTO user_roles (school_id, user_id, role_id, reason)
       SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = $3`,
      [school.id, id, roleCode],
    );
  }
  return { id, sub };
}

export async function createApp(): Promise<NestFastifyApplication> {
  process.env.AUTH_DEV_BYPASS = '1';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: 26_214_400 }),
  );
  try {
    await setupApp(app, loadEnv());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  } catch (error) {
    // Release database and Redis handles so a setup failure fails the suite instead of hanging Jest.
    await app.close().catch(() => undefined);
    await moduleRef.close().catch(() => undefined);
    throw error;
  }
}

export function headersFor(
  sub: string,
  schoolId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { authorization: `Bearer dev:${sub}`, 'x-school-id': schoolId, ...extra };
}

export interface InjectOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  json?: unknown;
  raw?: { body: Buffer; contentType: string };
}

export function injector(app: NestFastifyApplication) {
  return (opts: InjectOptions) => {
    const headers = { ...opts.headers };
    let payload: string | Buffer | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(opts.json);
    } else if (opts.raw) {
      headers['content-type'] = opts.raw.contentType;
      payload = opts.raw.body;
    }
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: opts.method,
        url: opts.url.startsWith('http') ? opts.url : `/api/v1${opts.url}`,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
  };
}
