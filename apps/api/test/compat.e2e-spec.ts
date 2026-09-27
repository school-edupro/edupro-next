/**
 * Compatibility API skeleton (S4-05): the current apps' handshake token becomes an app session, and the
 * legacy-shaped read endpoints answer under that session.
 */
import { createHmac } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

const SECRET = process.env.COMPAT_HANDSHAKE_SECRET ?? 'dev-compat-handshake-secret';

function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

describe('compatibility API (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let teacher: SeededUser;
  let mobile: string;

  beforeAll(async () => {
    const s = stamp('CMP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      await c.query("UPDATE users SET legacy_ref = 'E0042' WHERE id = $1", [teacher.id]);
      mobile = (
        await c.query<{ mobile: string }>('SELECT mobile FROM users WHERE id = $1', [teacher.id])
      ).rows[0]!.mobile;
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const exp = () => Math.floor(Date.now() / 1000) + 300;

  it('rejects tampered, expired and unknown handshake tokens with the legacy envelope', async () => {
    const tampered = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: {
        token: sign({ user_id_string: 'E0042', school_id: school.id, exp: exp() }, 'wrong-secret'),
      },
    });
    expect(tampered.statusCode).toBe(200);
    expect(tampered.json()).toEqual({ status: false, info: 'Invalid token' });
    const expired = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: { token: sign({ user_id_string: 'E0042', school_id: school.id, exp: exp() - 600 }) },
    });
    expect(expired.json()).toEqual({ status: false, info: 'Token expired' });
    const unknown = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: { token: sign({ user_id_string: 'NOBODY', school_id: school.id, exp: exp() }) },
    });
    expect(unknown.json()).toMatchObject({
      status: false,
      info: 'Please contact to Administrator',
    });
  });

  it('issues an app session for a known person by legacy id or mobile and serves the legacy shapes', async () => {
    const res = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: {
        token: sign({
          user_id_string: 'E0042',
          school_id: school.id,
          mobile_number: `+91 ${mobile}`,
          exp: exp(),
        }),
        type: 'employee',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: true,
      info: 'Logged in successfully',
      data: { user_id: 'E0042', is_employee: true, school_id: school.id },
    });
    const token: string = res.json().data.token;
    expect(token.startsWith('compat.')).toBe(true);

    const byMobile = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: {
        token: sign({
          user_id_string: 'X',
          school_id: school.id,
          mobile_number: mobile,
          exp: exp(),
        }),
      },
    });
    expect(byMobile.json().status).toBe(true);

    const auth = { authorization: `Bearer ${token}` }; // no X-School-Id: the school travels in the session
    const menu = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetMenuDetail',
      headers: auth,
    });
    expect(menu.statusCode).toBe(200);
    expect(menu.json().items.length).toBeGreaterThanOrEqual(4);
    expect(menu.json().items[0]).toMatchObject({
      menu_name: 'Attendance',
      status: '1',
      link_order: '1',
    });

    const config = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetSchoolConfig',
      headers: auth,
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().items[0]).toMatchObject({
      SchoolId: school.id,
      PREFIX: school.code,
      SchoolName: school.code,
    });

    const modules = await inject({
      method: 'GET',
      url: '/compat/v1/teacher/get_module_permissions',
      headers: auth,
    });
    expect(modules.statusCode).toBe(200);
    expect(modules.json()).toMatchObject({
      status: true,
      data: { teacher_types: ['classteacher'] },
    });
    expect(modules.json().data.modules.attendance).toContain('classteacher');

    const me = await inject({ method: 'GET', url: '/me', headers: auth });
    expect(me.statusCode).toBe(200);
    expect(me.json().school).toEqual({ id: school.id });
    const forged = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetMenuDetail',
      headers: { authorization: `Bearer ${token}x` },
    });
    expect(forged.statusCode).toBe(401);
  });
});
