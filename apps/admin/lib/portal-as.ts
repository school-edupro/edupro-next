'use server';
import { ApiError, apiFetch } from './api';

/** One person a portal can be opened as (docs/design/31-portal-view-as.md). */
export interface PortalTarget {
  personType: 'student' | 'guardian' | 'employee';
  id: string;
  as: string;
  name: string;
  app: 'parent' | 'teacher';
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

/** Starts the session; the link opens the portal (once, within a minute). */
export async function portalOpen(input: {
  personType: PortalTarget['personType'];
  id: string;
  mode: 'view' | 'act';
  reason: string;
  minutes: number;
}): Promise<Out<{ url: string }>> {
  if (!idOk(input.id)) return { ok: false, error: 'Unknown person' };
  try {
    const r = await apiFetch<{ url: string }>('/access/portal-as', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: true, data: { url: r.url } };
  } catch (e) {
    return fail(e);
  }
}
