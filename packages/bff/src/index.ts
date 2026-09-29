/**
 * Backend-for-frontend kit (ADR-007) for the parent and teacher apps (S5-08). The admin app carries an
 * older copy of the same code in apps/admin/lib; folding it onto this package is a Sprint 6 chore.
 */
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import * as client from 'openid-client';

export interface BffOptions {
  /** Cookie prefix, for example "edupro_parent". */
  cookie: string;
  /** Post-login destination when none is given. */
  home?: string;
}

export interface Session {
  sub: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  displayName?: string;
  schoolId?: string;
  /** Sprint 12: a previous (closed or locked) year chosen for history views; absent = the active year. */
  academicYearId?: string;
}

export interface Me {
  user: { id: string; displayName: string; mfa: boolean };
  memberships: Array<{
    schoolId: string;
    schoolCode: string;
    schoolName: string;
    personType: string;
  }>;
  school: { id: string } | null;
  academicYear: { id: string; code: string | null; status: string | null } | null;
  /** Open (non-planned) academic years of the selected school, newest first; used by the year switch. */
  academicYears: Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
  }>;
  permissions: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { type: string; title?: string; detail?: string; [k: string]: unknown },
  ) {
    super(problem.detail ?? problem.title ?? problem.type);
    this.name = 'ApiError';
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function createBff(options: BffOptions) {
  const SESSION_COOKIE = `${options.cookie}_session`;
  const LOGIN_COOKIE = `${options.cookie}_login`;
  const MAX_AGE = 12 * 60 * 60;
  const home = options.home ?? '/';

  const env = {
    get apiBaseUrl() {
      return process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:4000';
    },
    get sessionSecret() {
      const secret = required('SESSION_SECRET');
      if (process.env.NODE_ENV === 'production' && secret.startsWith('change-me'))
        throw new Error('SESSION_SECRET must be set to a real value in production');
      return secret;
    },
    get oidc() {
      return {
        issuer: required('ONEAUTH_ISSUER'),
        clientId: required('ONEAUTH_CLIENT_ID'),
        clientSecret: required('ONEAUTH_CLIENT_SECRET'),
        redirectUri: required('ONEAUTH_REDIRECT_URI'),
        mfaAcr: process.env.ONEAUTH_MFA_ACR ?? 'mfa',
      };
    },
    get devBypass() {
      return process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_BYPASS === '1';
    },
  };

  function key(): Uint8Array {
    const raw = Buffer.from(env.sessionSecret, 'base64');
    if (raw.length >= 32) return new Uint8Array(raw.subarray(0, 32));
    return new Uint8Array(Buffer.from(env.sessionSecret.padEnd(32, '0').slice(0, 32)));
  }

  const session = {
    async write(s: Session): Promise<void> {
      const token = await new EncryptJWT(s as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
        .setIssuedAt()
        .setExpirationTime(`${MAX_AGE}s`)
        .encrypt(key());
      const store = await cookies();
      store.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: MAX_AGE,
      });
    },
    async read(): Promise<Session | null> {
      const store = await cookies();
      const token = store.get(SESSION_COOKIE)?.value;
      if (!token) return null;
      try {
        const { payload } = await jwtDecrypt(token, key());
        const s = payload as unknown as Session;
        return s.accessToken && s.sub ? s : null;
      } catch {
        return null;
      }
    },
    async clear(): Promise<void> {
      const store = await cookies();
      store.delete(SESSION_COOKIE);
    },
  };

  let configPromise: Promise<client.Configuration> | undefined;
  const oidcConfig = () => {
    if (!configPromise)
      configPromise = client.discovery(
        new URL(env.oidc.issuer),
        env.oidc.clientId,
        env.oidc.clientSecret,
      );
    return configPromise;
  };

  const api = {
    async fetch<T>(path: string, init: RequestInit = {}): Promise<T> {
      const s = await session.read();
      if (!s) throw new ApiError(401, { type: 'unauthenticated' });
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${s.accessToken}`);
      headers.set('Accept', 'application/json');
      if (!headers.has('Content-Type') && init.body)
        headers.set('Content-Type', 'application/json');
      if (s.schoolId) headers.set('X-School-Id', s.schoolId);
      if (s.academicYearId) headers.set('X-Academic-Year-Id', s.academicYearId);
      headers.set('X-Request-Id', crypto.randomUUID());
      const res = await fetch(`${env.apiBaseUrl}/api/v1${path}`, {
        ...init,
        headers,
        cache: 'no-store',
      });
      if (res.status === 204) return undefined as T;
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok)
        throw new ApiError(res.status, { type: String(body.type ?? 'request-error'), ...body });
      return body as T;
    },
    me(): Promise<Me> {
      return api.fetch<Me>('/me');
    },
  };

  const safeReturn = (returnTo: string | null | undefined): string =>
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : home;

  const handlers = {
    /** GET /api/auth/login */
    async login(req: NextRequest) {
      const returnTo = safeReturn(req.nextUrl.searchParams.get('returnTo'));
      const config = await oidcConfig();
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: env.oidc.redirectUri,
        scope: 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      const store = await cookies();
      store.set(LOGIN_COOKIE, JSON.stringify({ codeVerifier, state, nonce, returnTo }), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      });
      return NextResponse.redirect(url.href);
    },
    /** GET /api/auth/callback */
    async callback(req: NextRequest) {
      const store = await cookies();
      const raw = store.get(LOGIN_COOKIE)?.value;
      store.delete(LOGIN_COOKIE);
      if (!raw) return NextResponse.redirect(new URL('/login?error=login-expired', req.url));
      const pending = JSON.parse(raw) as {
        codeVerifier: string;
        state: string;
        nonce: string;
        returnTo: string;
      };
      try {
        const config = await oidcConfig();
        const tokens = await client.authorizationCodeGrant(config, req.nextUrl, {
          pkceCodeVerifier: pending.codeVerifier,
          expectedState: pending.state,
          expectedNonce: pending.nonce,
        });
        const claims = tokens.claims();
        if (!claims?.sub) throw new Error('no subject');
        const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;
        await session.write({
          sub: claims.sub,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
          displayName: typeof claims.name === 'string' ? claims.name : undefined,
        });
        return NextResponse.redirect(new URL(safeReturn(pending.returnTo), req.url));
      } catch {
        return NextResponse.redirect(new URL('/login?error=login-failed', req.url));
      }
    },
    /** POST /api/auth/logout */
    async logout(req: NextRequest) {
      await session.clear();
      // signedOut=1 lets the app shell drop its offline cache of personal pages (Sprint 21)
      return NextResponse.redirect(new URL('/login?signedOut=1', req.url), { status: 303 });
    },
    /** POST /api/auth/dev (development bypass only) */
    async dev(req: NextRequest) {
      if (!env.devBypass) return NextResponse.json({ type: 'not-found' }, { status: 404 });
      const form = await req.formData();
      const sub = String(form.get('sub') ?? '').trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sub))
        return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
      await session.write({
        sub: `dev:${sub}`,
        accessToken: `dev:${sub}`,
        expiresAt: Math.floor(Date.now() / 1000) + 12 * 3600,
        displayName: sub,
      });
      return NextResponse.redirect(
        new URL(safeReturn(String(form.get('returnTo') ?? '')), req.url),
        { status: 303 },
      );
    },
    /** POST /api/context: choose the working school and, optionally, a previous academic year */
    async context(req: NextRequest) {
      const s = await session.read();
      if (!s) return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
      const form = await req.formData();
      const schoolId = String(form.get('schoolId') ?? '');
      const academicYearId = form.get('academicYearId');
      const next: Session = { ...s };
      if (/^[0-9]{1,18}$/.test(schoolId) && schoolId !== s.schoolId) {
        next.schoolId = schoolId;
        next.academicYearId = undefined; // years are school-specific; the API falls back to the active year
      }
      if (typeof academicYearId === 'string') {
        if (/^[0-9]{1,18}$/.test(academicYearId)) next.academicYearId = academicYearId;
        else if (academicYearId === '') next.academicYearId = undefined;
      }
      await session.write(next);
      return NextResponse.redirect(
        new URL(safeReturn(String(form.get('returnTo') ?? '')), req.url),
        {
          status: 303,
        },
      );
    },
  };

  /** Middleware: redirect anonymous visitors to /login; static assets and auth routes stay public. */
  const middleware =
    (publicPaths: string[] = []) =>
    (req: NextRequest) => {
      const { pathname } = req.nextUrl;
      const open = [
        '/login',
        '/api/auth',
        '/manifest.webmanifest',
        '/sw.js',
        '/icons',
        '/healthz',
        ...publicPaths,
      ];
      if (
        open.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
        pathname.startsWith('/_next')
      )
        return NextResponse.next();
      if (!req.cookies.get(SESSION_COOKIE)) {
        const login = req.nextUrl.clone();
        login.pathname = '/login';
        login.searchParams.set('returnTo', pathname);
        return NextResponse.redirect(login);
      }
      return NextResponse.next();
    };

  return { env, session, api, handlers, middleware, cookies: { session: SESSION_COOKIE } };
}
