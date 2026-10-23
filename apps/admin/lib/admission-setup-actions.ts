'use server';
/** Admission set-up and session actions (docs/design/39, part 2). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { AdmissionSettings, FeeCategory, SessionPlan } from './admission-setup';

type Out<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function problem(e: unknown): { ok: false; error: string } {
  if (e instanceof ApiError) {
    const list = e.problem.errors as
      Array<string | { message?: string; path?: string[] }> | undefined;
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
async function call<T>(
  path: string,
  method: string,
  body: unknown,
  revalidate: string,
): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, { method, body: JSON.stringify(body) });
    revalidatePath(revalidate);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function saveAdmissionSettings(s: AdmissionSettings) {
  return call<AdmissionSettings>('/admissions/setup/settings', 'PUT', s, '/admissions/setup');
}
export async function saveFeeCategories(
  categories: Array<Omit<FeeCategory, 'sortOrder' | 'id'> & { id?: string }>,
) {
  return call<FeeCategory[]>(
    '/admissions/setup/categories',
    'PUT',
    { categories },
    '/admissions/setup',
  );
}
export async function saveSessionClasses(id: string, classes: unknown[]) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown session' };
  return call<SessionPlan>(
    `/admissions/cycles/${id}/classes`,
    'PUT',
    { classes },
    `/admissions/cycles/${id}`,
  );
}
export async function saveSessionFees(id: string, fees: SessionPlan['fees']) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown session' };
  return call<SessionPlan>(
    `/admissions/cycles/${id}/fees`,
    'PUT',
    { fees },
    `/admissions/cycles/${id}`,
  );
}
export async function saveSessionRefund(
  id: string,
  refundDeductionPct: number,
  offerDays?: number,
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown session' };
  return call<SessionPlan>(
    `/admissions/cycles/${id}/settings`,
    'PUT',
    { refundDeductionPct, ...(offerDays ? { offerDays } : {}) },
    `/admissions/cycles/${id}`,
  );
}

/** Name, dates, instructions and status of the session (never its classes). */
export async function updateAdmissionSession(fd: FormData) {
  const id = str(fd, 'id');
  const body: Record<string, unknown> = {};
  if (fd.has('name')) {
    body.name = str(fd, 'name');
    body.instructions = str(fd, 'instructions') || null;
    body.opensAt = new Date(str(fd, 'opensAt')).toISOString();
    body.closesAt = new Date(str(fd, 'closesAt')).toISOString();
  }
  if (fd.has('status')) body.status = str(fd, 'status');
  let error = '';
  try {
    if (!okId(id)) throw new Error('Unknown session');
    await apiFetch(`/admissions/cycles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (e) {
    error = problem(e).error;
  }
  revalidatePath(`/admissions/cycles/${id}`);
  redirect(
    error
      ? `/admissions/cycles/${id}?error=session&detail=${encodeURIComponent(error.slice(0, 300))}`
      : `/admissions/cycles/${id}?ok=1&r=${Date.now().toString(36)}&detail=${encodeURIComponent(fd.has('status') ? `Session ${str(fd, 'status') === 'open' ? 'opened' : str(fd, 'status') === 'closed' ? 'closed' : 'saved'}` : 'Session saved')}`,
  );
}
