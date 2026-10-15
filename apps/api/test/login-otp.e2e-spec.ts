/**
 * Sign-in with an emailed code (0136): the school's rule (One Auth only, One Auth + code, code alone),
 * the code on screen while emails are corrected, wrong / used codes, remembered devices, a One Auth
 * token refused until the code is given, and the school's log of codes shown on screen.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
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

describe('sign-in with an emailed code (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let jwks: Server;
  let key: KeyLike;
  const s = stamp('OTP');
  const email = `${s.toLowerCase()}@example.test`;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const setting = (key: string, value: unknown) =>
    inject({ method: 'PUT', url: `/platform/settings/${key}`, headers: h(), json: { value } });
  const oneAuthToken = (sub: string) =>
    new SignJWT({ amr: ['pwd'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(process.env.ONEAUTH_ISSUER!)
      .setAudience(process.env.ONEAUTH_AUDIENCE!)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);

  beforeAll(async () => {
    // a local One Auth key set, so a signed One Auth token reaches the guard as in production
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    jwks = createServer((_, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r));
    process.env.ONEAUTH_JWKS_URL = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/jwks.json`;
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'accountant');
      await c.query(`UPDATE users SET email = $2 WHERE id = $1`, [clerk.id, email]);
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
    jwks?.close();
  });

  it('One Auth only (the default): no code is asked and a One Auth token works', async () => {
    // the guard keeps a user's rule a minute: the admin's token here, the clerk's in the next test
    const t = await oneAuthToken(admin.sub);
    const me = await inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${t}`, 'x-school-id': school.id },
    });
    expect(me.statusCode).toBe(200);
    const start = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/start',
      headers: { authorization: `Bearer ${t}` },
      json: { app: 'admin' },
    });
    expect(start.json()).toEqual({ notRequired: true });
    expect(
      (await inject({ method: 'GET', url: '/auth/otp/offered', headers: {} })).json(),
    ).toMatchObject({
      offered: expect.any(Boolean),
    });
  });

  it('One Auth + code: the One Auth token is refused until the mailed code is given', async () => {
    expect((await setting('auth.login_mode', 'oneauth_otp')).statusCode).toBe(200);
    const t = await oneAuthToken(clerk.sub);
    const refused = await inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${t}`, 'x-school-id': school.id },
    });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().type).toBe('otp-required');
    const start = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/start',
      headers: { authorization: `Bearer ${t}` },
      json: { app: 'admin' },
    });
    expect(start.statusCode).toBe(200);
    const st = start.json();
    expect(st.sentTo).toMatch(/^o\*+@example\.test$/);
    expect(st.screenCode).toBeUndefined(); // not shown on screen unless the school says so
    // the code went to the queue as an email to the clerk
    const mail = await withMigrator((c) =>
      c.query<{ subject: string; body: string }>(
        `SELECT subject, body FROM comms_messages WHERE school_id = $1 AND recipient_address = $2 ORDER BY id DESC LIMIT 1`,
        [school.id, email],
      ),
    );
    const code = /(\d{6}) is your sign-in code/.exec(mail.rows[0]!.subject)![1]!;
    const wrong = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/verify',
      headers: { authorization: `Bearer ${t}` },
      json: { challengeId: st.challengeId, code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().type).toBe('auth.otp_wrong');
    // another user's One Auth token cannot answer the clerk's code
    const other = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/verify',
      headers: { authorization: `Bearer ${await oneAuthToken(admin.sub)}` },
      json: { challengeId: st.challengeId, code },
    });
    expect(other.statusCode).toBe(401);
  });

  it('a right code gives a session; "remember" skips the code next time on that browser', async () => {
    expect((await setting('auth.otp_on_screen', true)).statusCode).toBe(200);
    const t = await oneAuthToken(clerk.sub);
    // codes are one per 30 seconds: let the earlier one age
    await withMigrator((c) =>
      c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 minute' WHERE user_id = $1`,
        [clerk.id],
      ),
    );
    const st = (
      await inject({
        method: 'POST',
        url: '/auth/otp/second-factor/start',
        headers: { authorization: `Bearer ${t}` },
        json: { app: 'admin' },
      })
    ).json();
    expect(st.screenCode).toMatch(/^\d{6}$/);
    const ok = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/verify',
      headers: { authorization: `Bearer ${t}` },
      json: { challengeId: st.challengeId, code: st.screenCode, remember: true },
    });
    expect(ok.statusCode).toBe(200);
    const session = ok.json();
    expect(session.accessToken).toMatch(/^otp\./);
    expect(session.deviceToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const me = await inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-school-id': school.id },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.mfa).toBe(true); // One Auth and the code
    // the code works once
    const again = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/verify',
      headers: { authorization: `Bearer ${t}` },
      json: { challengeId: st.challengeId, code: st.screenCode },
    });
    expect(again.json().type).toBe('auth.otp_used');
    // the remembered browser gets its session without a code
    const remembered = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/start',
      headers: { authorization: `Bearer ${t}` },
      json: { app: 'admin', deviceToken: session.deviceToken },
    });
    expect(remembered.json().session.accessToken).toMatch(/^otp\./);
    // a remembered browser counts for its own app only
    const teacherApp = await inject({
      method: 'POST',
      url: '/auth/otp/second-factor/start',
      headers: { authorization: `Bearer ${t}` },
      json: { app: 'teacher', deviceToken: session.deviceToken },
    });
    expect(teacherApp.json().session).toBeUndefined();
  });

  it('the code alone: email or mobile, the same answer for an unknown login, five wrong tries lock it', async () => {
    // the school still asks One Auth first: the code alone is not offered for its users
    const notYet = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: email, app: 'admin' },
    });
    // the vague answer, or (when some school of this installation shows codes on screen) a plain "not found"
    if (notYet.statusCode === 200) expect(notYet.json().screenCode).toBeUndefined();
    else expect(notYet.json().type).toBe('auth.otp_not_found');
    expect((await setting('auth.login_mode', 'otp')).statusCode).toBe(200);
    await withMigrator((c) =>
      c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 hour' WHERE user_id = $1`,
        [clerk.id],
      ),
    );
    const st = (
      await inject({
        method: 'POST',
        url: '/auth/otp/start',
        headers: {},
        json: { login: email.toUpperCase(), app: 'admin' },
      })
    ).json();
    expect(st.screenCode).toMatch(/^\d{6}$/);
    // this school shows codes on screen: an unknown login is told so plainly
    const unknown = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: 'nobody@example.test', app: 'admin' },
    });
    expect(unknown.json().type).toBe('auth.otp_not_found');
    for (let i = 0; i < 4; i++) {
      const w = await inject({
        method: 'POST',
        url: '/auth/otp/verify',
        headers: {},
        json: {
          challengeId: st.challengeId,
          code: st.screenCode === '000000' ? '111111' : '000000',
        },
      });
      expect(w.json().type).toBe('auth.otp_wrong');
    }
    const fifth = await inject({
      method: 'POST',
      url: '/auth/otp/verify',
      headers: {},
      json: { challengeId: st.challengeId, code: st.screenCode === '000000' ? '111111' : '000000' },
    });
    expect(fifth.json().type).toBe('auth.otp_locked');
    const late = await inject({
      method: 'POST',
      url: '/auth/otp/verify',
      headers: {},
      json: { challengeId: st.challengeId, code: st.screenCode },
    });
    expect(late.json().type).toBe('auth.otp_locked');
    // by mobile number, a fresh code signs in (code alone: not two factors)
    const mobile = await withMigrator((c) =>
      c.query<{ mobile: string }>(`SELECT mobile FROM users WHERE id = $1`, [clerk.id]),
    );
    await withMigrator((c) =>
      c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 hour' WHERE user_id = $1`,
        [clerk.id],
      ),
    );
    const byMobile = (
      await inject({
        method: 'POST',
        url: '/auth/otp/start',
        headers: {},
        json: { login: `+91 ${mobile.rows[0]!.mobile}`, app: 'admin' },
      })
    ).json();
    const ok = await inject({
      method: 'POST',
      url: '/auth/otp/verify',
      headers: {},
      json: { challengeId: byMobile.challengeId, code: byMobile.screenCode },
    });
    expect(ok.statusCode).toBe(200);
    const me = await inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${ok.json().accessToken}`, 'x-school-id': school.id },
    });
    expect(me.json().user.mfa).toBe(false);
    // a resend within 30 seconds is refused
    const soon = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: email, app: 'admin' },
    });
    expect(soon.statusCode).toBe(409);
  });

  it("parents by the school's records: admission no. or the guardian's mobile; a first sign-in makes the account", async () => {
    // code alone and on screen (set in the test before); the guardians have no login account yet
    const mobile = `98${String(Date.now()).slice(-8)}`;
    const ids = await withMigrator(async (c) => {
      const st = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Kid', 'Otp') RETURNING id::text`,
        [school.id, `${s}K`],
      );
      const father = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile, email) VALUES ($1, 'Father', 'Otp', $2, $3) RETURNING id::text`,
        [school.id, mobile, `f.${s.toLowerCase()}@example.test`],
      );
      const mother = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile) VALUES ($1, 'Mother', 'Otp', $2) RETURNING id::text`,
        [school.id, mobile],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true), ($1, $2, $4, 'mother', false)`,
        [school.id, st.rows[0]!.id, father.rows[0]!.id, mother.rows[0]!.id],
      );
      return { father: father.rows[0]!.id, mother: mother.rows[0]!.id };
    });
    const st = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: `${s}k`, app: 'parent' },
    });
    expect(st.statusCode).toBe(200);
    expect(st.json().sentTo).toMatch(/^f\*+@example\.test$/);
    const ok = await inject({
      method: 'POST',
      url: '/auth/otp/verify',
      headers: {},
      json: { challengeId: st.json().challengeId, code: st.json().screenCode },
    });
    expect(ok.statusCode).toBe(200);
    // the father now has an account: a guardian of the school with the parent role, linked to his record
    const made = await withMigrator((c) =>
      c.query<{ id: string; user_id: string | null; roles: string | null; person: string | null }>(
        `SELECT g.id::text, g.user_id::text,
                (SELECT string_agg(r.code, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = g.user_id AND ur.school_id = g.school_id) AS roles,
                (SELECT m.person_type::text FROM user_school_memberships m WHERE m.user_id = g.user_id AND m.school_id = g.school_id) AS person
           FROM guardians g WHERE g.id = ANY($1::bigint[]) ORDER BY g.id`,
        [[ids.father, ids.mother]],
      ),
    );
    expect(made.rows[0]).toMatchObject({ roles: 'parent', person: 'guardian' });
    expect(made.rows[0]!.user_id).not.toBeNull();
    // the mother shares the mobile: no second account
    expect(made.rows[1]!.user_id).toBeNull();
    // the shared mobile signs in to the same account
    await withMigrator((c) =>
      c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 hour' WHERE user_id = $1`,
        [made.rows[0]!.user_id],
      ),
    );
    const byMobile = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: mobile, app: 'parent' },
    });
    expect(byMobile.statusCode).toBe(200);
    expect(byMobile.json().screenCode).toMatch(/^\d{6}$/);
    // with the code on screen, an unknown login is told plainly
    const unknown = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: 'nobody-here@example.test', app: 'parent' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().type).toBe('auth.otp_not_found');
  });

  it('the code goes as a formatted email, the approved WhatsApp template and the DLT SMS', async () => {
    await withMigrator(async (c) => {
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, status, dlt_template_id)
         VALUES ($1, 'otp_sms_test', 'sms', 'OTP message', 'Dear User,Your OTP is {{otp}}.Team Mobilise', 'active', '1207163922745202205')`,
        [school.id],
      );
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, status, wa_template_name)
         VALUES ($1, 'otp_verifcation', 'whatsapp', 'otp_verifcation', '*{{otp}}* is your verification code. For your security, do not share this code.', 'active', 'otp_verifcation')`,
        [school.id],
      );
      await c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 hour' WHERE user_id = $1`,
        [clerk.id],
      );
    });
    const st = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: email, app: 'admin' },
    });
    expect(st.statusCode).toBe(200);
    expect(st.json().sentTo).toMatch(
      /@example\.test · WhatsApp \d{2}\*{6}\d{2} · SMS \d{2}\*{6}\d{2}$/,
    );
    const code = st.json().screenCode as string;
    const msgs = await withMigrator((c) =>
      c.query<{
        channel: string;
        subject: string | null;
        body: string;
        format: string;
        params: string[] | null;
      }>(
        `SELECT channel::text, subject, body, format, params FROM comms_messages
          WHERE school_id = $1 AND recipient_user_id = $2 AND created_at > now() - interval '1 minute' ORDER BY id`,
        [school.id, clerk.id],
      ),
    );
    const by = Object.fromEntries(msgs.rows.map((m) => [m.channel, m]));
    expect(by.email!.format).toBe('html');
    expect(by.email!.body).toContain(code);
    expect(by.email!.subject).toContain(code);
    expect(by.whatsapp!.params).toEqual([code]);
    expect(by.sms!.body).toBe(`Dear User,Your OTP is ${code}.Team Mobilise`);
  });

  it('the code goes only on the channels the school ticked', async () => {
    const set = await inject({
      method: 'PUT',
      url: '/platform/settings/auth.otp_channels',
      headers: h(),
      json: { value: ['whatsapp'] },
    });
    expect(set.statusCode).toBe(200);
    await withMigrator((c) =>
      c.query(
        `UPDATE auth_otp_challenges SET created_at = created_at - interval '1 hour' WHERE user_id = $1`,
        [clerk.id],
      ),
    );
    const before = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages WHERE recipient_user_id = $1`,
        [clerk.id],
      ),
    );
    const st = await inject({
      method: 'POST',
      url: '/auth/otp/start',
      headers: {},
      json: { login: email, app: 'admin' },
    });
    expect(st.json().sentTo).toMatch(/^WhatsApp \d{2}\*{6}\d{2}$/);
    const after = await withMigrator((c) =>
      c.query<{ channel: string }>(
        `SELECT channel::text FROM comms_messages WHERE recipient_user_id = $1 ORDER BY id OFFSET $2`,
        [clerk.id, before.rows[0]!.n],
      ),
    );
    expect(after.rows.map((r) => r.channel)).toEqual(['whatsapp']);
    // none ticked is refused
    const none = await inject({
      method: 'PUT',
      url: '/platform/settings/auth.otp_channels',
      headers: h(),
      json: { value: [] },
    });
    expect(none.statusCode).toBe(400);
    await inject({
      method: 'PUT',
      url: '/platform/settings/auth.otp_channels',
      headers: h(),
      json: { value: ['email', 'whatsapp', 'sms'] },
    });
  });

  it('the school sees the codes shown on screen and who has no email, and can forget remembered devices', async () => {
    const log = await inject({ method: 'GET', url: '/auth/otp/screen-log', headers: h() });
    expect(log.statusCode).toBe(200);
    expect(log.json().shown.length).toBeGreaterThanOrEqual(3);
    expect(log.json().noEmail.map((u: { id: string }) => u.id)).toContain(admin.id);
    expect(log.json().noEmail.map((u: { id: string }) => u.id)).not.toContain(clerk.id);
    const forget = await inject({ method: 'POST', url: '/auth/otp/forget-devices', headers: h() });
    expect(forget.json().forgotten).toBeGreaterThanOrEqual(1);
    const clerkLog = await inject({
      method: 'GET',
      url: '/auth/otp/screen-log',
      headers: h(clerk),
    });
    expect(clerkLog.statusCode).toBe(403);
    // back to One Auth only, so nothing else in this school is affected
    await setting('auth.login_mode', 'oneauth');
    await setting('auth.otp_on_screen', false);
  });
});
