'use server';
/** Moving a registration to the other school of the group (docs/design/64). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Out<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);

async function call<T>(
  path: string,
  method: string,
  body: unknown,
  paths: string[],
): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) {
      const list = e.problem.errors as Array<string | { message?: string }> | undefined;
      const msgs = Array.isArray(list)
        ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
        : [];
      return {
        ok: false,
        error: msgs.length ? msgs.join('. ') : (e.problem.detail ?? e.problem.type),
      };
    }
    throw e;
  }
}

export interface MoveOutcome {
  fee: number;
  category: string | null;
  className: string;
  session: string;
  carried: number;
  toRegistration: number;
  differenceDue: number;
  credit: number;
  missing: string[];
}

export async function requestMove(id: string, body: { toSchoolId: string; reason: string }) {
  if (!okId(id) || !okId(body.toSchoolId)) return { ok: false as const, error: 'Unknown school' };
  return call<{ id: string }>(`/admissions/registrations/${id}/move`, 'POST', body, [
    `/admissions/registrations/${id}`,
    '/admissions/moves',
  ]);
}

export async function previewMove(id: string, body: { cycleId: string; classId: string }) {
  if (!okId(id) || !okId(body.cycleId) || !okId(body.classId))
    return { ok: false as const, error: 'Choose the session and the class' };
  return call<MoveOutcome>(`/admissions/moves/${id}/preview`, 'POST', body, []);
}

export async function acceptMove(
  id: string,
  body: { cycleId: string; classId: string; note?: string },
) {
  if (!okId(id) || !okId(body.cycleId) || !okId(body.classId))
    return { ok: false as const, error: 'Choose the session and the class' };
  return call<{ applicationId: string; newNumber: string | null }>(
    `/admissions/moves/${id}/accept`,
    'POST',
    body,
    ['/admissions/moves', `/admissions/moves/${id}`, '/admissions/list'],
  );
}

export async function closeMove(id: string, how: 'refuse' | 'withdraw', note: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown move' };
  return call(`/admissions/moves/${id}/${how}`, 'POST', { note }, [
    '/admissions/moves',
    `/admissions/moves/${id}`,
  ]);
}

export async function useAdmissionCredit(id: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call<{ used: number; receiptNo: string | null; admissionNo: string | null }>(
    `/admissions/registrations/${id}/use-credit`,
    'POST',
    undefined,
    [`/admissions/registrations/${id}`, '/admissions/list'],
  );
}
