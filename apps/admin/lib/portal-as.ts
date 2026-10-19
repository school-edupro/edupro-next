'use server';
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import { readSession, writeSession } from './session';

/** One person a portal can be opened as (docs/design/31-portal-view-as.md). */
export interface PortalTarget {
  personType: 'student' | 'guardian' | 'employee';
  id: string;
  as: string;
  name: string;
  /** the parent portal; for an employee the teacher app, or this admin app (0188) */
  app: 'parent' | 'teacher' | 'admin';
  hasLogin: boolean;
  canMakeLogin: boolean;
  blocked: string | null;
}
export interface PortalTargets {
  targets: PortalTarget[];
  modes: { view: boolean; act: boolean };
}
type Out<T> = { ok: true; data: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof ApiError) return { ok: false, error: e.problem.detail ?? e.problem.type };
  throw e;
};
const idOk = (id: string) => /^\d{1,18}$/.test(id);

/** The student and each parent (or the employee) with their logins. */
export async function portalTargets(
  kind: 'student' | 'employee',
  id: string,
): Promise<Out<PortalTargets>> {
  if (!idOk(id)) return { ok: false, error: 'Unknown person' };
  try {
    return { ok: true, data: await apiFetch<PortalTargets>(`/access/portal-as/${kind}/${id}`) };
  } catch (e) {
    return fail(e);
  }
}

/** A login for one who has none. */
export async function portalMakeLogin(
  personType: PortalTarget['personType'],
  id: string,
): Promise<Out<{ userId: string }>> {
  if (!idOk(id)) return { ok: false, error: 'Unknown person' };
  try {
    const data = await apiFetch<{ userId: string }>('/access/portal-as/login', {
      method: 'POST',
      body: JSON.stringify({ personType, id }),
    });
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Starts the session. A portal: the link opens it in a new tab (once, within a minute). The admin app
 * (an employee, 0188): this very session becomes theirs until End, which brings the admin back to
 * `returnTo`; the caller reloads the page.
 */
export async function portalOpen(input: {
  personType: PortalTarget['personType'];
  id: string;
  app?: PortalTarget['app'];
  mode: 'view' | 'act';
  reason: string;
  minutes: number;
  returnTo?: string;
}): Promise<Out<{ url: string; inPlace: boolean }>> {
  if (!idOk(input.id)) return { ok: false, error: 'Unknown person' };
  const { returnTo, ...body } = input;
  try {
    const r = await apiFetch<{
      url: string | null;
      app: PortalTarget['app'];
      token?: string;
      sub?: string;
      displayName?: string;
      expiresAt?: string;
      session: { id: string; targetName: string; expiresAt: string };
    }>('/access/portal-as', { method: 'POST', body: JSON.stringify(body) });
    if (r.app !== 'admin' && r.url) return { ok: true, data: { url: r.url, inPlace: false } };
    const session = await readSession();
    if (!session || !r.token) return { ok: false, error: 'Your session has ended; sign in again' };
    await writeSession({
      ...session,
      accessToken: r.token,
      impersonation: {
        sessionId: r.session.id,
        targetName: r.session.targetName,
        expiresAt: r.session.expiresAt,
        originalAccessToken: session.accessToken,
        mode: input.mode,
        returnTo:
          returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
            ? returnTo
            : '/people/employees',
      },
    });
    revalidatePath('/');
    return { ok: true, data: { url: '/', inPlace: true } };
  } catch (e) {
    return fail(e);
  }
}
