import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { env } from './env';

/**
 * Encrypted, HttpOnly session cookie (ADR-007). Holds the One Auth tokens and the selected school and year.
 * The browser never sees the access token; server components and the proxy route read it here.
 */
export interface Session {
  sub: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // unix seconds
  displayName?: string;
  schoolId?: string;
  academicYearId?: string;
  /** Set while acting as another member (S5-02); the original token is restored when the session ends. */
  impersonation?: {
    sessionId: string;
    targetName: string;
    expiresAt: string;
    originalAccessToken: string;
  };
}

const COOKIE = 'edupro_session';
const CONTEXT_COOKIE = 'edupro_ctx';
const MAX_AGE_SECONDS = 12 * 60 * 60;

function key(): Uint8Array {
  const raw = Buffer.from(env.sessionSecret, 'base64');
  if (raw.length >= 32) return new Uint8Array(raw.subarray(0, 32));
  // Fallback for non-base64 secrets: derive 32 bytes deterministically (dev only).
  return new Uint8Array(Buffer.from(env.sessionSecret.padEnd(32, '0').slice(0, 32)));
}

export async function writeSession(session: Session): Promise<void> {
  const token = await new EncryptJWT(session as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .encrypt(key());
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key());
    const session = payload as unknown as Session;
    if (!session.accessToken || !session.sub) return null;
    return session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  store.delete(CONTEXT_COOKIE);
}

/** School and year selection travel in a separate, non-sensitive cookie so switching does not re-encrypt tokens. */
export interface WorkingContext {
  schoolId?: string;
  academicYearId?: string;
}

export async function readContext(): Promise<WorkingContext> {
  const store = await cookies();
  const raw = store.get(CONTEXT_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as WorkingContext;
    const id = /^[0-9]{1,18}$/;
    return {
      schoolId: parsed.schoolId && id.test(parsed.schoolId) ? parsed.schoolId : undefined,
      academicYearId:
        parsed.academicYearId && id.test(parsed.academicYearId) ? parsed.academicYearId : undefined,
    };
  } catch {
    return {};
  }
}

export async function writeContext(ctx: WorkingContext): Promise<void> {
  const store = await cookies();
  store.set(CONTEXT_COOKIE, JSON.stringify(ctx), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}
