/**
 * Sign-in with a code by email (0136), shared by the admin, teacher and parent apps. The code alone
 * (email or mobile number, then the code) or a code after One Auth, as the school chooses. The pending
 * step lives in a short-lived encrypted cookie (it may carry the One Auth token until the code is given);
 * "remember this device" keeps a random token in a 30-day HttpOnly cookie of the browser.
 */
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export type OtpApp = 'admin' | 'teacher' | 'parent';
export interface OtpPending {
  purpose: 'login' | 'second_factor';
  challengeId: string;
  sentTo: string | null;
  /** Shown on screen when the school allows it (the rollout while emails are corrected). */
  screenCode?: string;
  /** The email or mobile typed, to send a new code. */
  login?: string;
  /** One Auth token held until the code is given (second factor). */
  oneAuthToken?: string;
  returnTo: string;
}
export interface OtpSessionOut {
  sub: string;
  accessToken: string;
  expiresAt: number;
  displayName?: string;
}
export interface OtpOptions {
  /** Cookie prefix, for example "edupro_parent"; the admin app uses "edupro". */
  cookie: string;
  app: OtpApp;
  apiBaseUrl: () => string;
  sessionKey: () => Uint8Array;
  writeSession: (s: OtpSessionOut) => Promise<void>;
  recordSignIn?: (req: NextRequest, token: string) => Promise<void>;
}

const PENDING_MINUTES = 15;
const DEVICE_DAYS = 30;

export function createOtp(o: OtpOptions) {
  const PENDING = `${o.cookie}_otp`;
  const DEVICE = `${o.cookie}_device`;
  const secure = process.env.NODE_ENV === 'production';

  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${o.apiBaseUrl()}/api/v1/auth/otp/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  };

  const pending = {
    async write(p: OtpPending) {
      const token = await new EncryptJWT(p as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime(`${PENDING_MINUTES}m`)
        .encrypt(o.sessionKey());
      (await cookies()).set(PENDING, token, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: PENDING_MINUTES * 60,
      });
    },
    async read(): Promise<OtpPending | null> {
      const raw = (await cookies()).get(PENDING)?.value;
      if (!raw) return null;
      try {
        return (await jwtDecrypt(raw, o.sessionKey())).payload as unknown as OtpPending;
      } catch {
        return null;
      }
    },
    async clear() {
      (await cookies()).delete(PENDING);
    },
  };
  const device = async () => (await cookies()).get(DEVICE)?.value;
  const meta = (req: NextRequest) => ({
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? undefined,
  });
  const safe = (v: unknown) => {
    const s = typeof v === 'string' ? v : '';
    return s.startsWith('/') && !s.startsWith('//') ? s : '/';
  };
  const to = (req: NextRequest, path: string) =>
    NextResponse.redirect(new URL(path, req.url), { status: 303 });
  const errorOf = (json: Record<string, unknown>) =>
    encodeURIComponent(String(json.detail ?? json.type ?? 'Something went wrong'));

  /** The session is ready: write it, remember the device when asked, go on. */
  const finish = async (
    req: NextRequest,
    s: OtpSessionOut & { deviceToken?: string },
    returnTo: string,
  ) => {
    await o.writeSession({
      sub: s.sub,
      accessToken: s.accessToken,
      expiresAt: s.expiresAt,
      displayName: s.displayName,
    });
    if (s.deviceToken)
      (await cookies()).set(DEVICE, s.deviceToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: DEVICE_DAYS * 86400,
      });
    await pending.clear();
    if (o.recordSignIn) await o.recordSignIn(req, s.accessToken);
    return to(req, safe(returnTo));
  };

  return {
    pending,
    /** Is the code-only sign-in offered (some school uses it)? For the sign-in page. */
    async offered(): Promise<boolean> {
      try {
        const res = await fetch(`${o.apiBaseUrl()}/api/v1/auth/otp/offered`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        return Boolean(((await res.json()) as { offered?: boolean }).offered);
      } catch {
        return false;
      }
    },
    /**
     * Right after One Auth: when a school of the user asks a code, hold the One Auth token in the pending
     * cookie and send the user to /login/otp; otherwise null (the caller writes the One Auth session).
     */
    async afterOneAuth(
      req: NextRequest,
      oneAuthToken: string,
      returnTo: string,
    ): Promise<NextResponse | null> {
      const r = await post(
        'second-factor/start',
        { app: o.app, deviceToken: await device() },
        oneAuthToken,
      );
      if (r.ok && r.json.notRequired) return null;
      if (r.ok && r.json.session) return finish(req, r.json.session as OtpSessionOut, returnTo);
      if (!r.ok) return to(req, `/login?error=${errorOf(r.json)}`);
      await pending.write({
        purpose: 'second_factor',
        challengeId: String(r.json.challengeId),
        sentTo: (r.json.sentTo as string | null) ?? null,
        screenCode: r.json.screenCode as string | undefined,
        oneAuthToken,
        returnTo: safe(returnTo),
      });
      return to(req, '/login/otp');
    },
    handlers: {
      /** POST /api/auth/otp/start: the code alone, step 1 (email or mobile number) */
      async start(req: NextRequest) {
        const form = await req.formData();
        const login = String(form.get('login') ?? '').trim();
        const returnTo = safe(form.get('returnTo'));
        if (login.length < 3)
          return to(
            req,
            `/login?otpError=${encodeURIComponent('Enter your email or mobile number')}`,
          );
        const r = await post('start', {
          login,
          app: o.app,
          deviceToken: await device(),
          ...meta(req),
        });
        if (!r.ok) return to(req, `/login?otpError=${errorOf(r.json)}`);
        if (r.json.session) return finish(req, r.json.session as OtpSessionOut, returnTo);
        await pending.write({
          purpose: 'login',
          challengeId: String(r.json.challengeId),
          sentTo: (r.json.sentTo as string | null) ?? null,
          screenCode: r.json.screenCode as string | undefined,
          login,
          returnTo,
        });
        return to(req, '/login/otp');
      },
      /** POST /api/auth/otp/verify: the code */
      async verify(req: NextRequest) {
        const p = await pending.read();
        if (!p) return to(req, '/login?error=login-expired');
        const form = await req.formData();
        const code = String(form.get('code') ?? '').replace(/\D/g, '');
        const remember = form.get('remember') === 'on';
        const r =
          p.purpose === 'login'
            ? await post('verify', {
                challengeId: p.challengeId,
                code,
                remember,
                userAgent: meta(req).userAgent,
              })
            : await post(
                'second-factor/verify',
                { challengeId: p.challengeId, code, remember, userAgent: meta(req).userAgent },
                p.oneAuthToken,
              );
        if (!r.ok) return to(req, `/login/otp?error=${errorOf(r.json)}`);
        return finish(
          req,
          r.json as unknown as OtpSessionOut & { deviceToken?: string },
          p.returnTo,
        );
      },
      /** POST /api/auth/otp/resend: a new code (one in 30 seconds) */
      async resend(req: NextRequest) {
        const p = await pending.read();
        if (!p) return to(req, '/login?error=login-expired');
        const r =
          p.purpose === 'login'
            ? await post('start', { login: p.login, app: o.app, ...meta(req) })
            : await post('second-factor/start', { app: o.app }, p.oneAuthToken);
        if (!r.ok) return to(req, `/login/otp?error=${errorOf(r.json)}`);
        await pending.write({
          ...p,
          challengeId: String(r.json.challengeId),
          sentTo: (r.json.sentTo as string | null) ?? null,
          screenCode: r.json.screenCode as string | undefined,
        });
        return to(req, '/login/otp?resent=1');
      },
      /** POST /api/auth/otp/cancel: back to the sign-in page */
      async cancel(req: NextRequest) {
        await pending.clear();
        return to(req, '/login');
      },
    },
  };
}
