/**
 * Reference module end to end: authorisation matrix, tenant isolation through the API, year lock.
 * Requires DATABASE_URL, DATABASE_MIGRATOR_URL, AUTH_DEV_BYPASS=1 and migrations applied.
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';

const MIGRATOR_URL =
  process.env.DATABASE_MIGRATOR_URL ?? 'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';

interface Fixture {
  schoolA: string;
  schoolB: string;
  yearA: string;
  coordinatorSub: string; // academic_coordinator in school A
  teacherSub: string; // class_teacher in school A (view only)
  outsiderSub: string; // school_admin in school B
}

async function seed(): Promise<Fixture> {
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    const stamp = `E2E${Date.now().toString(36).toUpperCase()}`;
    const school = async (code: string) => {
      const s = await c.query<{ id: string }>(`INSERT INTO schools (code, name) VALUES ($1, $1) RETURNING id::text`, [code]);
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2026-27', 'Session', '2026-04-01', '2027-03-31', 'active') RETURNING id::text`,
        [s.rows[0]!.id],
      );
      return { id: s.rows[0]!.id, yearId: y.rows[0]!.id };
    };
    const a = await school(`${stamp}A`);
    const b = await school(`${stamp}B`);

    const user = async (sub: string, schoolId: string, roleCode: string) => {
      const u = await c.query<{ id: string }>(
        `INSERT INTO users (oneauth_sub, display_name) VALUES ($1, $1) RETURNING id::text`,
        [sub],
      );
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, 'employee')`,
        [schoolId, u.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = $3`,
        [schoolId, u.rows[0]!.id, roleCode],
      );
    };
    const coordinatorSub = `${stamp}-coord`;
    const teacherSub = `${stamp}-teacher`;
    const outsiderSub = `${stamp}-outsider`;
    await user(coordinatorSub, a.id, 'academic_coordinator');
    await user(teacherSub, a.id, 'class_teacher');
    await user(outsiderSub, b.id, 'school_admin');

    return { schoolA: a.id, schoolB: b.id, yearA: a.yearId, coordinatorSub, teacherSub, outsiderSub };
  } finally {
    await c.end();
  }
}

describe('academics/classes (e2e)', () => {
  let app: NestFastifyApplication;
  let f: Fixture;

  const headers = (sub: string, schoolId: string) => ({
    authorization: `Bearer dev:${sub}`,
    'x-school-id': schoolId,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    process.env.AUTH_DEV_BYPASS = '1';
    f = await seed();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const inject = (opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; headers: Record<string, string>; payload?: unknown }) => {
    // Fastify rejects a JSON content type with an empty body, so only send it with a payload.
    const { 'content-type': contentType, ...rest } = opts.headers;
    const headers = opts.payload !== undefined && contentType ? { ...rest, 'content-type': contentType } : rest;
    return app.getHttpAdapter().getInstance().inject({
      method: opts.method,
      url: `/api/v1${opts.url}`,
      headers,
      ...(opts.payload !== undefined ? { payload: JSON.stringify(opts.payload) } : {}),
    });
  };

  let classId: string;

  it('rejects unauthenticated requests', async () => {
    const res = await inject({ method: 'GET', url: '/academics/classes', headers: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ type: 'unauthenticated' });
  });

  it('rejects a school the user is not a member of', async () => {
    const res = await inject({ method: 'GET', url: '/academics/classes', headers: headers(f.coordinatorSub, f.schoolB) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: 'tenant-forbidden' });
  });

  it('coordinator can create a class', async () => {
    const res = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: headers(f.coordinatorSub, f.schoolA),
      payload: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    expect(res.statusCode).toBe(201);
    classId = res.json().id;
    expect(classId).toMatch(/^[0-9]+$/);
  });

  it('validation errors are problem details', async () => {
    const res = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: headers(f.coordinatorSub, f.schoolA),
      payload: { code: '', name: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ type: 'validation-failed' });
  });

  it('duplicate code is a 409 conflict', async () => {
    const res = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: headers(f.coordinatorSub, f.schoolA),
      payload: { code: 'VI', name: 'Again' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'conflict' });
  });

  it('class teacher can view but not create', async () => {
    const list = await inject({ method: 'GET', url: '/academics/classes', headers: headers(f.teacherSub, f.schoolA) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((c: { id: string }) => c.id)).toContain(classId);

    const create = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: headers(f.teacherSub, f.schoolA),
      payload: { code: 'VII', name: 'Class VII' },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({ type: 'permission-denied', permission: 'academics.class.create' });
  });

  it('another school never sees the class, even with full rights there', async () => {
    const res = await inject({ method: 'GET', url: `/academics/classes/${classId}`, headers: headers(f.outsiderSub, f.schoolB) });
    expect(res.statusCode).toBe(404);
  });

  it('creates a section in the active year and lists it', async () => {
    const created = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: headers(f.coordinatorSub, f.schoolA),
      payload: { name: 'A', capacity: 40 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'A', academicYearId: f.yearA });

    const listed = await inject({
      method: 'GET',
      url: `/academics/classes/${classId}/sections`,
      headers: headers(f.coordinatorSub, f.schoolA),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
  });

  it('refuses to create a section when the academics stage is locked', async () => {
    const m = new Client({ connectionString: MIGRATOR_URL });
    await m.connect();
    try {
      await m.query(`UPDATE academic_years SET locks = '{"academics": true}'::jsonb WHERE id = $1`, [f.yearA]);
      const res = await inject({
        method: 'POST',
        url: `/academics/classes/${classId}/sections`,
        headers: headers(f.coordinatorSub, f.schoolA),
        payload: { name: 'B' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'year.stage_locked' });
    } finally {
      await m.query(`UPDATE academic_years SET locks = '{}'::jsonb WHERE id = $1`, [f.yearA]);
      await m.end();
    }
  });

  it('refuses to delete a class that has sections in an open year', async () => {
    const res = await inject({ method: 'DELETE', url: `/academics/classes/${classId}`, headers: headers(f.coordinatorSub, f.schoolA) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ type: 'academics.class.has_sections' });
  });

  it('writes an audit row for the create', async () => {
    const m = new Client({ connectionString: MIGRATOR_URL });
    await m.connect();
    try {
      const r = await m.query(
        `SELECT action, permission_code FROM audit_logs WHERE entity_type = 'classes' AND entity_id = $1 AND source = 'api' ORDER BY id`,
        [classId],
      );
      expect(r.rows.map((x) => x.action)).toContain('academics.class.create');
      expect(r.rows[0]?.permission_code).toBe('academics.class.create');
    } finally {
      await m.end();
    }
  });

  it('GET /me returns memberships and permissions', async () => {
    const res = await inject({ method: 'GET', url: '/me', headers: headers(f.teacherSub, f.schoolA) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.memberships.map((m: { schoolId: string }) => m.schoolId)).toEqual([f.schoolA]);
    expect(body.permissions).toContain('academics.class.view');
    expect(body.permissions).not.toContain('academics.class.create');
  });
});
