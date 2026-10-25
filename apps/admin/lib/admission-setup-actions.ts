'use server';
/** Admission set-up and session actions (docs/design/39, part 2). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type {
  AdmissionSettings,
  FeeCategory,
  LatePasscode,
  PointRule,
  RegistrationPoints,
  SessionPlan,
  SessionPoints,
} from './admission-setup';

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
/** The session's merit points: its list, and each class on the session's list or its own. */
export async function saveSessionPoints(
  id: string,
  body: {
    session: PointRule[];
    classes: Array<{ classId: string; own: boolean; rules: PointRule[] }>;
  },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown session' };
  const clean = (l: PointRule[]) =>
    l.map(({ name, logic, conditions, points }) => ({ name, logic, conditions, points }));
  return call<SessionPoints>(
    `/admissions/cycles/${id}/points`,
    'PUT',
    {
      session: clean(body.session),
      classes: body.classes.map((k) => ({ ...k, rules: clean(k.rules) })),
    },
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
  if (fd.get('confirmCategoryGaps') !== null) body.confirmCategoryGaps = true;
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

/**
 * A new admission session: the year, name, registration dates and fee. Classes, forms, seats and fees
 * are set on the session's own page, which opens next. The code defaults to ADM-<year>.
 */
export async function createAdmissionSession(fd: FormData) {
  const yearId = str(fd, 'academicYearId');
  let code = str(fd, 'code').toUpperCase();
  let id = '';
  let error = '';
  try {
    if (!code) {
      const years = await apiFetch<{ data: Array<{ id: string; code: string }> }>(
        '/platform/years',
      );
      const y = years.data.find((x) => x.id === yearId);
      code = y ? `ADM-${y.code}`.replace(/[^A-Z0-9-]/g, '').slice(0, 20) : '';
    }
    const r = await apiFetch<{ id: string }>('/admissions/cycles', {
      method: 'POST',
      body: JSON.stringify({
        academicYearId: yearId,
        code,
        name: str(fd, 'name'),
        opensAt: new Date(str(fd, 'opensAt')).toISOString(),
        closesAt: new Date(str(fd, 'closesAt')).toISOString(),
        applicationFee: Number(str(fd, 'applicationFee') || '0'),
        criteria: [],
        // merit points are set on the session's Merit points tab (docs/design/40)
        scoreCriteria: [],
      }),
    });
    id = r.id;
  } catch (e) {
    error = problem(e).error;
  }
  revalidatePath('/admissions/cycles');
  redirect(
    error
      ? `/admissions/cycles?error=session&detail=${encodeURIComponent(error.slice(0, 300))}`
      : `/admissions/cycles/${id}?ok=1&detail=${encodeURIComponent('Session created. Now add its classes, forms and seats.')}`,
  );
}

/** The office confirms a registration's merit points (awarding differently with a reason), or works them out again. */
export async function checkRegistrationPoints(
  id: string,
  action: 'confirm' | 'recalculate',
  lines: Array<{ name: string; points: number; reason?: string }> = [],
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call<RegistrationPoints | null>(
    `/admissions/registrations/${id}/points`,
    'POST',
    { action, lines },
    `/admissions/registrations/${id}`,
  );
}

/** A late-entry passcode for a family (mailed), a new one in its place, or revoked (docs/design/41). */
export async function giveLatePasscode(
  sessionId: string,
  body: {
    classId: string;
    email: string;
    mobile?: string;
    childName?: string;
    validUntil: string;
    note?: string;
  },
) {
  if (!okId(sessionId)) return { ok: false as const, error: 'Unknown session' };
  return call<LatePasscode[]>(
    `/admissions/cycles/${sessionId}/passcodes`,
    'POST',
    body,
    `/admissions/cycles/${sessionId}`,
  );
}
export async function latePasscodeAction(
  sessionId: string,
  id: string,
  action: 'resend' | 'revoke',
) {
  if (!okId(sessionId) || !okId(id)) return { ok: false as const, error: 'Unknown passcode' };
  return call<LatePasscode[]>(
    `/admissions/passcodes/${id}/${action}`,
    'POST',
    {},
    `/admissions/cycles/${sessionId}`,
  );
}
