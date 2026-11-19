/**
 * The mobile app's foundations (docs/design/89, phase A): a phone signs in with the one-time code (or a One Auth
 * token), refreshes with rotating tokens (an old one played again signs it out), lists and signs out phones;
 * profiles (a teacher who is also a parent in the same school), each profile's menu and "acting as" the parent;
 * web pages opened inside the app with a one-time link; pushes to a phone without the school's own Firebase.
 * Every name, number and token here is made up.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: number;
}

describe('mobile app: sign-in, phones, profiles, web pages, push (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let tp: SeededUser;
  let tpMobile = '';
  let childId = '';
  const s = stamp('MOB');
  const device = (id: string, platform: 'android' | 'ios' = 'android') => ({
    id: `phone-${s}-${id}`,
    name: `Test phone ${id}`,
    platform,
    appVersion: '1.0.0',
  });
  const bearer = (t: string, more: Record<string, string> = {}) => ({
    authorization: `Bearer ${t}`,
    'x-school-id': school.id,
    ...more,
  });
  /** a phone session from a One Auth token (the development token stands in for One Auth) */
  const phone = async (u: SeededUser, id: string): Promise<Tokens> => {
    const r = await inject({
      method: 'POST',
      url: '/auth/mobile/one-auth',
      headers: headersFor(u.sub, school.id),
      json: { device: device(id) },
    });
    expect(r.statusCode).toBe(200);
    return r.json() as Tokens;
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // a class teacher who is also the parent of a pupil of the same school
      tp = await seedUser(c, school, `${s}-tp`, 'class_teacher');
      tpMobile = (
        await c.query<{ mobile: string }>(`SELECT mobile FROM users WHERE id = $1`, [tp.id])
      ).rows[0]!.mobile;
      await c.query(
        `INSERT INTO user_school_memberships (school_id, user_id, person_type) VALUES ($1, $2, 'guardian')`,
        [school.id, tp.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'parent'`,
        [school.id, tp.id],
      );
      childId = (
        await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Kid', 'Mob') RETURNING id::text`,
          [school.id, `${s}K`],
        )
      ).rows[0]!.id;
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile, user_id) VALUES ($1, 'Parent', 'Mob', $2, $3) RETURNING id::text`,
        [school.id, tpMobile, tp.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
        [school.id, childId, g.rows[0]!.id],
      );
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    // nothing this test queued may go out
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it('the code signs a phone in; refresh turns the token; an old one at once is superseded, later signs the phone out', async () => {
    const h = headersFor(admin.sub, school.id);
    for (const [key, value] of [
      ['auth.login_mode', 'otp'],
      ['auth.otp_on_screen', true],
    ] as const)
      expect(
        (
          await inject({
            method: 'PUT',
            url: `/platform/settings/${key}`,
            headers: h,
            json: { value },
          })
        ).statusCode,
      ).toBe(200);
    const st = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: tpMobile, app: 'mobile' },
    });
    expect(st.statusCode).toBe(200);
    const { challengeId, screenCode } = st.json() as { challengeId: string; screenCode: string };
    const bad = await inject({
      method: 'POST',
      url: '/auth/mobile/verify',
      headers: {},
      json: { challengeId, code: screenCode, device: { ...device('A'), id: 'no' } },
    });
    expect(bad.statusCode).toBe(400);
    const v = await inject({
      method: 'POST',
      url: '/auth/mobile/verify',
      headers: {},
      json: { challengeId, code: screenCode, device: device('A') },
    });
    expect(v.statusCode).toBe(200);
    const a = v.json() as Tokens;
    expect(a.accessToken).toMatch(/^otp\./);
    expect(a.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const me = await inject({ method: 'GET', url: '/me', headers: bearer(a.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(tp.id);

    const refresh = (token: string) =>
      inject({
        method: 'POST',
        url: '/auth/mobile/refresh',
        headers: {},
        json: { refreshToken: token, deviceId: device('A').id, appVersion: '1.0.1' },
      });
    const r1 = await refresh(a.refreshToken);
    expect(r1.statusCode).toBe(200);
    const b = r1.json() as Tokens;
    expect(b.refreshToken).not.toBe(a.refreshToken);
    expect(b.sessionId).toBe(a.sessionId);
    // two refreshes at once: the second, with the old token, is told to use the newer one
    expect((await refresh(a.refreshToken)).json()).toMatchObject({
      type: 'auth.mobile_superseded',
    });
    // later, the old token again is a stolen one: the phone is signed out
    await withMigrator((c) =>
      c.query(`UPDATE mobile_sessions SET rotated_at = now() - interval '1 minute' WHERE id = $1`, [
        a.sessionId,
      ]),
    );
    const replay = await refresh(a.refreshToken);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ type: 'auth.mobile_reused' });
    expect((await refresh(b.refreshToken)).json()).toMatchObject({
      type: 'auth.mobile_signed_out',
    });
    const refused = await inject({ method: 'GET', url: '/me', headers: bearer(b.accessToken) });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ type: 'auth.mobile_signed_out' });
  });

  it("a person's phones: listed, another signed out, then this one", async () => {
    const b = await phone(tp, 'B');
    const c = await phone(tp, 'C');
    const list = await inject({
      method: 'GET',
      url: '/auth/mobile/devices',
      headers: bearer(b.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as Array<{ id: string; current: boolean; method: string }>;
    expect(rows.map((x) => [x.id === b.sessionId, x.current, x.method]).sort()).toEqual(
      [
        [false, false, 'oneauth'],
        [true, true, 'oneauth'],
      ].sort(),
    );
    // another person's phone is not mine to sign out
    const other = await phone(admin, 'X');
    expect(
      (
        await inject({
          method: 'POST',
          url: `/auth/mobile/devices/${other.sessionId}/sign-out`,
          headers: bearer(b.accessToken),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await inject({
          method: 'POST',
          url: `/auth/mobile/devices/${c.sessionId}/sign-out`,
          headers: bearer(b.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await inject({ method: 'GET', url: '/me', headers: bearer(c.accessToken) })).statusCode,
    ).toBe(401);
    expect(
      (
        await inject({
          method: 'POST',
          url: '/auth/mobile/sign-out',
          headers: bearer(b.accessToken),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await inject({ method: 'GET', url: '/me', headers: bearer(b.accessToken) })).statusCode,
    ).toBe(401);
  });

  it('profiles: staff and the parent of a child in the same school; each menu; acting as the parent', async () => {
    const d = await phone(tp, 'D');
    const p = await inject({ method: 'GET', url: '/me/profiles', headers: bearer(d.accessToken) });
    expect(p.statusCode).toBe(200);
    const profiles = p.json().data as Array<{
      id: string;
      kind: string;
      studentId: string | null;
      app: string;
      actingAs: string | null;
    }>;
    expect(profiles.map((x) => [x.id, x.kind, x.app, x.actingAs])).toEqual([
      [`staff:${school.id}`, 'staff', 'teacher', null],
      [`parent:${school.id}:${childId}`, 'parent', 'parent', 'family'],
    ]);
    const menu = async (kind: string, more: Record<string, string> = {}) =>
      inject({ method: 'GET', url: `/me/menu?kind=${kind}`, headers: bearer(d.accessToken, more) });
    const staff = (await menu('staff')).json() as {
      app: string;
      groups: Array<{ items: Array<{ href: string; icon: string }> }>;
    };
    expect(staff.app).toBe('teacher');
    expect(staff.groups.flatMap((g) => g.items.map((i) => i.href))).toContain('/attendance');
    const family = (await menu('parent', { 'x-acting-as': 'family' })).json() as typeof staff;
    expect(family.app).toBe('parent');
    expect(family.groups.flatMap((g) => g.items.map((i) => i.href))).toContain('/homework');
    expect((await menu('nobody')).statusCode).toBe(400);
    // as staff the family view is refused; acting as the parent it lists the child
    const asStaff = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: bearer(d.accessToken),
    });
    expect(asStaff.json()).toMatchObject({ type: 'engagement.family.staff' });
    const asParent = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: bearer(d.accessToken, { 'x-acting-as': 'family' }),
    });
    expect(asParent.statusCode).toBe(200);
    expect(JSON.stringify(asParent.json())).toContain(childId);
    // a person with no family membership acting as one gets no family view
    const admins = await phone(admin, 'E');
    expect(
      (
        await inject({
          method: 'GET',
          url: '/engagement/family',
          headers: bearer(admins.accessToken, { 'x-acting-as': 'family' }),
        })
      ).statusCode,
    ).not.toBe(200);
  });

  it('a web page inside the app: a one-time link, once, for its app only; it ends with the phone', async () => {
    const f = await phone(tp, 'F');
    const link = async (
      body: Record<string, string>,
      h: Record<string, string> = bearer(f.accessToken),
    ) => inject({ method: 'POST', url: '/auth/mobile/web-handoff', headers: h, json: body });
    expect((await link({ app: 'parent', to: '//elsewhere.example' })).statusCode).toBe(400);
    // only the mobile app opens pages this way
    expect(
      (await link({ app: 'parent', to: '/library' }, headersFor(tp.sub, school.id))).statusCode,
    ).toBe(403);
    const r = await link({ app: 'parent', to: '/library' });
    expect(r.statusCode).toBe(200);
    const url = new URL(r.json().url as string);
    expect(url.pathname).toBe('/api/auth/mobile');
    const code = url.searchParams.get('code')!;
    const redeem = (app: string) =>
      inject({
        method: 'POST',
        url: '/auth/mobile/web-handoff/redeem',
        headers: {},
        json: { code, app },
      });
    expect((await redeem('teacher')).statusCode).toBe(401);
    const w = await redeem('parent');
    expect(w.statusCode).toBe(200);
    expect(w.json()).toMatchObject({ to: '/library', schoolId: school.id });
    expect((await redeem('parent')).statusCode).toBe(401);
    const web = w.json().accessToken as string;
    expect((await inject({ method: 'GET', url: '/me', headers: bearer(web) })).statusCode).toBe(
      200,
    );
    await inject({ method: 'POST', url: '/auth/mobile/sign-out', headers: bearer(f.accessToken) });
    expect((await inject({ method: 'GET', url: '/me', headers: bearer(web) })).statusCode).toBe(
      401,
    );
  });

  it("pushes reach the phone without the school's own Firebase", async () => {
    const g = await phone(admin, 'G');
    const token = `fcm-${s}-${'x'.repeat(40)}`;
    const reg = await inject({
      method: 'POST',
      url: '/comms/push/devices',
      headers: bearer(g.accessToken),
      json: { token, app: 'mobile', platform: 'ios' },
    });
    expect(reg.statusCode).toBe(200);
    const test = await inject({
      method: 'POST',
      url: '/comms/push/test',
      headers: bearer(g.accessToken),
    });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ devices: 1 });
    const queued = await withMigrator(
      async (c) =>
        (
          await c.query<{ app: string | null; address: string }>(
            `SELECT variables->>'app' AS app, recipient_address AS address FROM comms_messages
            WHERE school_id = $1 AND channel = 'push' ORDER BY id DESC LIMIT 1`,
            [school.id],
          )
        ).rows[0],
    );
    expect(queued).toEqual({ app: 'mobile', address: token });
  });
});
