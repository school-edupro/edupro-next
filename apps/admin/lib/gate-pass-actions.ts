'use server';
/** Gate pass v2 server actions (0069): approve, make at the desk, hand over, gate out and in, staff passes, set-up. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { GatePassDetail, GatePassSetup } from './gate-passes';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/engagement/gate-passes';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((detailOf(error) || error.problem.type).slice(0, 300))}`,
    );
  throw error;
}
function returnTo(fd: FormData, fallback = BASE): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : fallback;
}
const withOk = (path: string, ok: string) => `${path}${path.includes('?') ? '&' : '?'}ok=${ok}`;

/** An approver decides at their level. */
export async function decidePass(fd: FormData) {
  const here = returnTo(fd, `${BASE}/approvals`);
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  try {
    await apiFetch(`/gate-passes/${str(fd, 'id')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, outcome));
}

/** The front desk makes a pupil's pass for a parent at the desk; it goes for approval. */
export async function deskCreatePass(fd: FormData) {
  const here = returnTo(fd, `${BASE}/new`);
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/gate-passes', {
        method: 'POST',
        body: JSON.stringify({
          studentId: str(fd, 'studentId'),
          kind: str(fd, 'kind') || 'early_leave',
          onDate: str(fd, 'onDate') || undefined,
          atTime: str(fd, 'atTime') || undefined,
          reason: str(fd, 'reason'),
          escortKind: str(fd, 'escortKind') || undefined,
          escortName: str(fd, 'escortName') || undefined,
          escortRelation: str(fd, 'escortRelation') || undefined,
          escortMobile: str(fd, 'escortMobile') || undefined,
        }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(`${BASE}/${id}`, 'requested'));
}

export type OtpResult =
  | { ok: true; sent: boolean; mobileEnd: string; minutes: number; devCode?: string }
  | { ok: false; error: string };
/** The one-time code to the parent before an outsider takes the child. */
export async function sendPassOtp(id: string): Promise<OtpResult> {
  try {
    const out = await apiFetch<{
      sent: boolean;
      mobileEnd: string;
      minutes: number;
      devCode?: string;
    }>(`/gate-passes/${id}/otp`, { method: 'POST', body: '{}' });
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

export type HandoverResult = { ok: true } | { ok: false; error: string };
/** The front desk hands the child over: the live photo and, for an outsider, the parent's code. */
export async function handoverPass(
  id: string,
  photo: string,
  otp: string,
): Promise<HandoverResult> {
  try {
    const out = await apiFetch<{ ok: boolean; error?: string }>(`/gate-passes/${id}/handover`, {
      method: 'POST',
      body: JSON.stringify({ photo, otp: otp || undefined }),
    });
    if (!out.ok) return { ok: false, error: out.error ?? 'The code is not right' };
    revalidatePath(BASE);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

export async function gateOutPass(fd: FormData) {
  const here = returnTo(fd, `${BASE}/gate`);
  try {
    await apiFetch(`/gate-passes/${str(fd, 'id')}/out`, {
      method: 'POST',
      body: JSON.stringify({
        gate: str(fd, 'gate') || undefined,
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'out'));
}

export async function gateInPass(fd: FormData) {
  const here = returnTo(fd, `${BASE}/gate`);
  const items = fd
    .getAll('itemId')
    .map((v) => String(v))
    .filter((v) => /^\d{1,18}$/.test(v))
    .map((id) => ({ id, returnedQty: Number(str(fd, `returned_${id}`) || 0) }));
  try {
    await apiFetch(`/gate-passes/${str(fd, 'id')}/in`, {
      method: 'POST',
      body: JSON.stringify({ note: str(fd, 'note') || undefined, items }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'in'));
}

/** The gate finds a pass by its scanned code or its number (posted, never in the address bar). */
export async function findPass(fd: FormData) {
  const code = str(fd, 'code');
  let id = '';
  try {
    id = (
      await apiFetch<GatePassDetail>('/gate-passes/gate/find', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
    ).id;
  } catch (error) {
    back(`${BASE}/gate`, error);
  }
  redirect(`${BASE}/gate?found=${id}`);
}

export type StaffApplyResult = { ok: true; id: string } | { ok: false; error: string };
/** An employee asks for an RGP / NRGP with the items carried out. */
export async function applyStaffPass(input: Record<string, unknown>): Promise<StaffApplyResult> {
  try {
    const out = await apiFetch<{ id: string }>('/gate-passes/staff', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(BASE);
    return { ok: true, id: out.id };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

export async function cancelStaffPass(fd: FormData) {
  const here = returnTo(fd, `${BASE}/mine`);
  try {
    await apiFetch(`/gate-passes/staff/${str(fd, 'id')}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') || undefined }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'cancelled'));
}

export type SetupResult = { ok: true } | { ok: false; error: string };
export async function saveGatePassSetup(input: {
  settings: GatePassSetup['settings'];
  levels: GatePassSetup['levels'];
}): Promise<SetupResult> {
  try {
    await apiFetch('/gate-passes/setup', {
      method: 'PUT',
      body: JSON.stringify({ ...input.settings, levels: input.levels }),
    });
    revalidatePath(`${BASE}/setup`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}
