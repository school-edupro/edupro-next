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
    expect(notYet.statusCode).toBe(200);
    expect(notYet.json().screenCode).toBeUndefined();
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
    const unknown = (
      await inject({
        method: 'POST',
        url: '/auth/otp/start',
        headers: {},
        json: { login: 'nobody@example.test', app: 'admin' },
      })
    ).json();
    expect(Object.keys(unknown).sort()).toEqual(['challengeId', 'sentTo']);
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
