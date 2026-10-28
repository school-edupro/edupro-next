'use server';
/** Draw of lots (docs/design/60): twins, the slips' settings, the hand draw checked and recorded. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type { DrawPlan, DrawSettings, DrawSettingsView } from './admission-draw';

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string | undefined) => !!id && /^\d{1,18}$/.test(id);
const PAGE = '/admissions/draw';

function problem(e: unknown): { ok: false; error: string } {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<string | { message?: string }> | undefined;
    const msgs = Array.isArray(list)
      ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
      : [];
    return {
      ok: false,
      error: msgs.length ? msgs.join('. ') : String(e.problem.detail ?? e.problem.type),
    };
  }
  throw e;
}
async function call<T>(path: string, method: string, body: unknown): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, { method, body: JSON.stringify(body) });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

/** Twins confirmed on one slip, or split onto a slip each. */
export async function setDrawTwins(p: {
  cycleId: string;
  classId: string;
  ids: string[];
  state: 'paired' | 'split';
}) {
  if (!okId(p.cycleId) || !okId(p.classId) || !p.ids.every(okId))
    return { ok: false as const, error: 'Unknown registrations' };
  return call<{ ids: string[]; state: string }>('/admissions/draw/twins', 'PUT', p);
}

/** The slips' settings of the session, or the class's own. */
export async function saveDrawSettings(
  p: { cycleId: string; classId?: string },
  s: DrawSettings,
): Promise<Out<DrawSettingsView>> {
  if (!okId(p.cycleId) || (p.classId && !okId(p.classId)))
    return { ok: false, error: 'Choose the session' };
  return call<DrawSettingsView>('/admissions/draw/settings', 'PUT', { ...p, ...s });
}

/** The class's own settings removed: it prints with the session's. */
export async function clearDrawSettings(p: {
  cycleId: string;
  classId: string;
}): Promise<Out<DrawSettingsView>> {
  if (!okId(p.cycleId) || !okId(p.classId)) return { ok: false, error: 'Choose the class' };
  try {
    const data = await apiFetch<DrawSettingsView>(
      `/admissions/draw/settings?${new URLSearchParams(p).toString()}`,
      { method: 'DELETE' },
    );
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

type DrawBody = {
  cycleId: string;
  classId: string;
  categoryId?: string;
  points: string;
  seats: number;
  numbers: string[];
  offerMessage?: { subject?: string; intro?: string; note?: string };
};
const bodyOk = (b: DrawBody) =>
  okId(b.cycleId) &&
  okId(b.classId) &&
  (!b.categoryId || okId(b.categoryId)) &&
  /^-?\d{1,7}(\.\d{1,2})?$/.test(b.points) &&
  Number.isInteger(b.seats) &&
  b.seats >= 1;

/** The drawn order checked: who would be offered, who waits, what is wrong (nothing changes). */
export async function checkDraw(b: DrawBody): Promise<Out<DrawPlan>> {
  if (!bodyOk(b)) return { ok: false, error: 'Choose the points total and the seats' };
  try {
    return {
      ok: true,
      data: await apiFetch<DrawPlan>('/admissions/draw/check', {
        method: 'POST',
        body: JSON.stringify(b),
      }),
    };
  } catch (e) {
    return problem(e);
  }
}

/** The hand draw recorded: the first seats offered (the offer email), the rest wait-listed. */
export async function recordDraw(b: DrawBody): Promise<Out<DrawPlan & { id: string }>> {
  if (!bodyOk(b)) return { ok: false, error: 'Choose the points total and the seats' };
  return call<DrawPlan & { id: string }>('/admissions/draw/record', 'POST', b);
}
