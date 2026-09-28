import { env } from './env';
import { readContext, readSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { type: string; title?: string; detail?: string; [k: string]: unknown },
  ) {
    super(problem.detail ?? problem.title ?? problem.type);
    this.name = 'ApiError';
  }
}

/**
 * Server-side call to the NestJS API with the user's token and the working school and year (ADR-007).
 * Client components never call this; they go through /api/proxy (Sprint 2), which uses the same helper.
 */
/** Same headers as apiFetch, but the raw Response (binary downloads such as upload templates). */
export async function apiFetchRaw(path: string): Promise<Response> {
  const session = await readSession();
  if (!session) throw new ApiError(401, { type: 'unauthenticated' });
  const ctx = await readContext();
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  const schoolId = ctx.schoolId ?? session.schoolId;
  const yearId = ctx.academicYearId ?? session.academicYearId;
  if (schoolId) headers.set('X-School-Id', schoolId);
  if (yearId) headers.set('X-Academic-Year-Id', yearId);
  headers.set('X-Request-Id', crypto.randomUUID());
  return fetch(`${env.apiBaseUrl}/api/v1${path}`, { headers, cache: 'no-store' });
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { token?: string } = {},
): Promise<T> {
  const session = await readSession();
  if (!session) throw new ApiError(401, { type: 'unauthenticated' });
  const ctx = await readContext();

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${options.token ?? session.accessToken}`);
  headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  const schoolId = ctx.schoolId ?? session.schoolId;
  const yearId = ctx.academicYearId ?? session.academicYearId;
  if (schoolId) headers.set('X-School-Id', schoolId);
  if (yearId) headers.set('X-Academic-Year-Id', yearId);
  headers.set('X-Request-Id', crypto.randomUUID());

  const res = await fetch(`${env.apiBaseUrl}/api/v1${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, { type: String(body.type ?? 'request-error'), ...body });
  }
  return body as T;
}

export interface Me {
  user: { id: string; displayName: string; mfa: boolean };
  impersonation: {
    sessionId: string;
    byUserId: string;
    byDisplayName: string;
    expiresAt: string;
  } | null;
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

export function getMe(): Promise<Me> {
  return apiFetch<Me>('/me');
}
