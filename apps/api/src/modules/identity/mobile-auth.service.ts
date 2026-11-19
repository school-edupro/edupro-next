import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import type { RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { OtpService } from './otp.service';

/** The phone a session belongs to (sent by the app at sign-in and refresh). */
export interface MobileDevice {
  /** the app's own install id */
  id: string;
  name?: string | undefined;
  platform: 'android' | 'ios' | 'web';
  appVersion?: string | undefined;
}

export interface MobileTokens {
  accessToken: string;
  /** unix seconds */
  expiresAt: number;
  refreshToken: string;
  sessionId: string;
  sub: string;
  displayName: string;
}

/** An access token lives an hour; the refresh token keeps the phone signed in (60 days unused ends it). */
const ACCESS_MINUTES = 60;
/** A web page opened inside the app gets a web session of its own for this long (and ends with the phone's). */
const WEB_HOURS = 12;
const HANDOFF_SECONDS = 60;

/**
 * The mobile app's sign-in (docs/design/89, phase A): a phone signs in with the one-time code (or One Auth,
 * then the code when the school asks it), keeps a refresh token in its secure storage and gets an access token
 * an hour at a time. Each refresh turns the refresh token into a new one; an old one played again signs the
 * phone out. Access tokens name the session, so a phone signed out (by its person or the school) is refused at
 * once. A web page inside the app is opened with a one-time code the web app turns into its own session.
 */
@Injectable()
export class MobileAuthService {
  /** session id → open, checked at most once a minute a session */
  private readonly openCache = new Map<string, { open: boolean; until: number }>();

  constructor(
    private readonly db: DbService,
    private readonly otp: OtpService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(token: string) {
    return createHmac('sha256', this.env.OTP_JWT_SECRET).update(`mobile:${token}`).digest('hex');
  }

  private async token(
    sub: string,
    claims: { app: string; msid: string; mfa: boolean; method: 'otp' | 'oneauth' },
    minutes: number,
  ) {
    const expiresAt = Math.floor(Date.now() / 1000) + minutes * 60;
    const amr = claims.mfa ? ['otp', 'mfa'] : claims.method === 'otp' ? ['otp'] : ['pwd'];
    const jwt = await new SignJWT({ amr, app: claims.app, msid: claims.msid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('edupro-otp')
      .setAudience('edupro-otp')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(new TextEncoder().encode(this.env.OTP_JWT_SECRET));
    return { accessToken: `otp.${jwt}`, expiresAt };
  }

  /** A new session for the phone: its refresh token and the first access token. */
  private async start(
    userId: string,
    device: MobileDevice,
    method: 'otp' | 'oneauth',
    mfa: boolean,
  ): Promise<MobileTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const sessionId = await this.db.global(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT app.mobile_session_start($1, $2, $3, $4, $5, $6, $7, $8) AS id`,
        [
          userId,
          device.id,
          device.name ?? null,
          device.platform,
          device.appVersion ?? null,
          method,
          mfa,
          this.hash(refreshToken),
        ],
      );
      return r.rows[0]!.id;
    });
    const u = await this.otp.user(userId);
    const t = await this.token(
      u.sub,
      { app: 'mobile', msid: sessionId, mfa, method },
      ACCESS_MINUTES,
    );
    return { ...t, refreshToken, sessionId, sub: u.sub, displayName: u.displayName };
  }

  /** The one-time code (asked with `app: 'mobile'`) signs the phone in. */
  async signInWithCode(challengeId: string, code: string, device: MobileDevice) {
    const { userId } = await this.otp.checkCode(challengeId, code, 'login');
    return this.start(userId, device, 'otp', false);
  }

  /** A One Auth sign-in (the token on the request) becomes the phone's session. */
  async signInWithOneAuth(ctx: RequestContext, device: MobileDevice) {
    if (ctx.user.mobileSessionId || ctx.user.impersonation)
      throw new DomainError('auth.mobile_not_one_auth', 'Sign in with One Auth first', {
        status: 400,
      });
    return this.start(ctx.user.id, device, 'oneauth', ctx.user.mfa);
  }

  /** One Auth, then the code the school asks: the phone's session counts as multi-factor. */
  async signInWithSecondFactor(
    ctx: RequestContext,
    challengeId: string,
    code: string,
    device: MobileDevice,
  ) {
    await this.otp.checkCode(challengeId, code, 'second_factor', ctx.user.id);
    return this.start(ctx.user.id, device, 'oneauth', true);
  }

  /** The refresh token turns into a new one, with a new access token. */
  async refresh(refreshToken: string, device: Pick<MobileDevice, 'id' | 'appVersion'>) {
    const next = randomBytes(32).toString('base64url');
    const r = await this.db.global(async (c) => {
      const x = await c.query<{
        outcome: string;
        session_id: string | null;
        user_id: string | null;
        mfa: boolean;
      }>(
        `SELECT outcome, session_id::text, user_id::text, mfa FROM app.mobile_session_refresh($1, $2, $3, $4)`,
        [this.hash(refreshToken), this.hash(next), device.id, device.appVersion ?? null],
      );
      return x.rows[0]!;
    });
    if (r.outcome === 'superseded')
      throw new DomainError(
        'auth.mobile_superseded',
        'This sign-in was just renewed: use the newer token',
        { status: 409 },
      );
    if (r.outcome !== 'ok' || !r.session_id || !r.user_id) {
      if (r.session_id) this.openCache.delete(r.session_id);
      throw new DomainError(
        r.outcome === 'expired'
          ? 'auth.mobile_expired'
          : r.outcome === 'reused'
            ? 'auth.mobile_reused'
            : 'auth.mobile_signed_out',
        r.outcome === 'expired'
          ? 'Signed out after a long time unused. Sign in again.'
          : 'This phone is signed out. Sign in again.',
        { status: 401 },
      );
    }
    const u = await this.otp.user(r.user_id);
    const method = await this.db.global(async (c) => {
      const m = await c.query<{ method: 'otp' | 'oneauth' }>(
        `SELECT method FROM app.mobile_sessions_of($1) WHERE id = $2`,
        [r.user_id, r.session_id],
      );
      return m.rows[0]?.method ?? 'otp';
    });
    const t = await this.token(
      u.sub,
      { app: 'mobile', msid: r.session_id, mfa: r.mfa, method },
      ACCESS_MINUTES,
    );
    return { ...t, refreshToken: next, sessionId: r.session_id };
  }

  /** Is the phone's session still open? (the auth guard asks for every token that names one) */
  async isOpen(sessionId: string): Promise<boolean> {
    const hit = this.openCache.get(sessionId);
    if (hit && hit.until > Date.now()) return hit.open;
    const open = await this.db.global(async (c) => {
      const r = await c.query<{ open: boolean }>(`SELECT app.mobile_session_open($1) AS open`, [
        sessionId,
      ]);
      return r.rows[0]?.open ?? false;
    });
    this.openCache.set(sessionId, { open, until: Date.now() + 60_000 });
    if (this.openCache.size > 20000) this.openCache.clear();
    return open;
  }

  /** The person's signed-in phones, this one marked. */
  async devices(ctx: RequestContext) {
    const rows = await this.db.global(async (c) => {
      const r = await c.query<{
        id: string;
        device_name: string | null;
        platform: string;
        app_version: string | null;
        method: string;
        created_at: Date;
        last_used_at: Date;
      }>(
        `SELECT id::text, device_name, platform, app_version, method, created_at, last_used_at
           FROM app.mobile_sessions_of($1)`,
        [ctx.user.id],
      );
      return r.rows;
    });
    return {
      data: rows.map((x) => ({
        id: x.id,
        name: x.device_name,
        platform: x.platform,
        appVersion: x.app_version,
        method: x.method,
        signedInAt: x.created_at.toISOString(),
        lastUsedAt: x.last_used_at.toISOString(),
        current: x.id === ctx.user.mobileSessionId,
      })),
    };
  }

  /**
   * Whether an app of this version must update (below MOBILE_MIN_VERSION: it stops at an "Update EduPro" page) or may
   * (below MOBILE_LATEST_VERSION: a line on top), with the store link of the platform (docs/design/89 phase D).
   */
  appVersion(platform: 'android' | 'ios' | 'web', version?: string) {
    const cmp = (a: string, b: string) => {
      const x = a.split('.').map(Number);
      const y = b.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    };
    const minimum = this.env.MOBILE_MIN_VERSION;
    const latest = this.env.MOBILE_LATEST_VERSION;
    return {
      minimum,
      latest,
      mustUpdate: version !== undefined && cmp(version, minimum) < 0,
      mayUpdate: version !== undefined && cmp(version, latest) < 0,
      storeUrl:
        platform === 'ios'
          ? (this.env.MOBILE_STORE_URL_IOS ?? null)
          : platform === 'android'
            ? (this.env.MOBILE_STORE_URL_ANDROID ?? null)
            : null,
    };
  }

  /** Signs a phone of the person out (this one, or another of theirs). */
  async signOut(ctx: RequestContext, sessionId?: string) {
    const id = sessionId ?? ctx.user.mobileSessionId;
    if (!id || !/^[0-9a-f-]{36}$/.test(id))
      throw new DomainError('not-found', 'No such signed-in phone', { status: 404 });
    const done = await this.db.global(async (c) => {
      const r = await c.query<{ ok: boolean }>(
        `SELECT app.mobile_session_revoke($1, $2, $2, $3) AS ok`,
        [id, ctx.user.id, sessionId ? 'signed out from another phone' : 'signed out'],
      );
      return r.rows[0]?.ok ?? false;
    });
    this.openCache.delete(id);
    if (!done) throw new DomainError('not-found', 'No such signed-in phone', { status: 404 });
    return { signedOut: true };
  }

  /** A one-time code that opens a web page inside the app, signed in (60 seconds, used once). */
  async webHandoff(ctx: RequestContext, app: 'parent' | 'teacher', to: string) {
    if (!ctx.user.mobileSessionId)
      throw new DomainError('auth.mobile_only', 'Only the mobile app opens web pages this way', {
        status: 403,
      });
    if (!to.startsWith('/') || to.startsWith('//') || to.length > 500)
      throw new DomainError('validation-failed', 'The page must be a path of the web app', {
        status: 400,
      });
    const code = randomBytes(32).toString('base64url');
    await this.db.global((c) =>
      c.query(`SELECT app.mobile_handoff_issue($1, $2, $3, $4, $5, $6, $7)`, [
        this.hash(code),
        ctx.user.mobileSessionId,
        ctx.user.id,
        app,
        ctx.tenant?.schoolId ?? null,
        to,
        HANDOFF_SECONDS,
      ]),
    );
    const base = app === 'parent' ? this.env.PARENT_APP_URL : this.env.TEACHER_APP_URL;
    return {
      url: `${base}/api/auth/mobile?code=${code}`,
      expiresAt: Math.floor(Date.now() / 1000) + HANDOFF_SECONDS,
    };
  }

  /** The web app turns the code in for its own session (it ends with the phone's). */
  async redeem(code: string, app: 'parent' | 'teacher') {
    const r = await this.db.global(async (c) => {
      const x = await c.query<{
        user_id: string;
        school_id: string | null;
        target: string;
        session_id: string;
        mfa: boolean;
      }>(
        `SELECT user_id::text, school_id::text, target, session_id::text, mfa FROM app.mobile_handoff_redeem($1, $2)`,
        [this.hash(code), app],
      );
      return x.rows[0];
    });
    if (!r)
      throw new DomainError('auth.handoff_invalid', 'The link has expired. Open the page again.', {
        status: 401,
      });
    const u = await this.otp.user(r.user_id);
    const t = await this.token(
      u.sub,
      { app, msid: r.session_id, mfa: r.mfa, method: 'otp' },
      WEB_HOURS * 60,
    );
    return {
      ...t,
      sub: u.sub,
      displayName: u.displayName,
      schoolId: r.school_id,
      to: r.target,
    };
  }
}
