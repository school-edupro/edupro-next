'use server';
/** Purchase Indents in the staff app (docs/design/83, part 2): raise, send, withdraw, decide, hand over. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from './bff';

const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
const detailOf = (e: ApiError) => {
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  if (Array.isArray(errs) && errs.length)
    return errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ');
  return typeof e.problem.detail === 'string' && e.problem.detail
    ? e.problem.detail
    : e.problem.type;
};
const apiFetch = <T = unknown>(path: string, init?: RequestInit) => bff.api.fetch<T>(path, init);
/** Back to a purchase page of this app with what happened. */
function back(to: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(to.startsWith('/purchase') ? to : '/purchase', 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 300));
  revalidatePath(url.pathname);
  redirect(`${url.pathname}${url.search}`);
}
async function run(to: string, fn: () => Promise<unknown>, done: string): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) back(to, e.problem.type, detailOf(e));
    throw e;
  }
  back(to, 'ok', done);
}

// ---- part 2: the Purchase Indent ------------------------------------------------------------------
export type IndentSaveResult =
  | { ok: true; id: string; number?: string }
  /** id: a new PI saved as a draft although sending it failed */
  | { ok: false; error: string; id?: string };

/** A PI saved as a draft (or changed), and sent for approval when asked; the form keeps what was typed. */
export async function saveIndent(
  id: string | null,
  body: Record<string, unknown>,
  submit: boolean,
): Promise<IndentSaveResult> {
  if (id && !okId(id)) return { ok: false, error: 'Unknown indent' };
  let saved: string | null = id;
  try {
    const r = await apiFetch<{ id: string }>(id ? `/purchase/indents/${id}` : '/purchase/indents', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
    saved = r.id;
    revalidatePath('/purchase');
    if (!submit) return { ok: true, id: r.id };
    const s = await apiFetch<{ id: string; number: string }>(`/purchase/indents/${r.id}/submit`, {
      method: 'POST',
    });
    return { ok: true, id: s.id, number: s.number };
  } catch (e) {
    if (e instanceof ApiError)
      return saved && !id
        ? { ok: false, id: saved, error: `Saved as a draft, not sent: ${detailOf(e)}` }
        : { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function submitIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const to = `/purchase/${id}`;
  if (!okId(id)) back('/purchase', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () => apiFetch(`/purchase/indents/${id}/submit`, { method: 'POST' }),
    'Sent for approval',
  );
}

export async function cancelIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const to = `/purchase/${id}`;
  if (!okId(id)) back('/purchase', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () =>
      apiFetch(`/purchase/indents/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: pick(fd, 'reason') }),
      }),
    'Indent withdrawn',
  );
}

export async function decideIndent(fd: FormData) {
  const id = pick(fd, 'id');
  const action = pick(fd, 'decision');
  const to = `/purchase/${id}`;
  if (!okId(id) || !['approve', 'reject', 'send_back'].includes(action))
    back('/purchase', 'validation-failed', 'Unknown indent');
  return run(
    to,
    () =>
      apiFetch(`/purchase/indents/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ action, note: pick(fd, 'reason') || undefined }),
      }),
    action === 'approve'
      ? 'Approved'
      : action === 'reject'
        ? 'Rejected: the raiser sees the reason'
        : 'Sent back to the raiser for changes',
  );
}

/** My PI, PR and PO approvals handed to a colleague for some days (the school admin: anyone's). */
export async function delegatePurchase(fd: FormData) {
  const to = '/purchase/hand-over';
  const fromUserId = pick(fd, 'fromUserId');
  const toEmployeeId = pick(fd, 'toEmployeeId');
  if (!okId(toEmployeeId) || (fromUserId && !okId(fromUserId)))
    back(to, 'validation-failed', 'Pick the colleague');
  return run(
    to,
    () =>
      apiFetch('/purchase/delegations', {
        method: 'POST',
        body: JSON.stringify({
          fromUserId: fromUserId || undefined,
          toEmployeeId,
          startsOn: pick(fd, 'startsOn'),
          endsOn: pick(fd, 'endsOn'),
          reason: pick(fd, 'reason'),
        }),
      }),
    'Approvals handed over for those days',
  );
}

export async function revokePurchaseDelegation(fd: FormData) {
  const id = pick(fd, 'id');
  const to = '/purchase/hand-over';
  if (!okId(id)) back(to, 'validation-failed', 'Unknown delegation');
  return run(
    to,
    () => apiFetch(`/purchase/delegations/${id}`, { method: 'DELETE' }),
    'Delegation ended',
  );
}

/** The decision buttons of one form (each its own action, as the staff app does elsewhere). */
export async function approveIndent(fd: FormData) {
  fd.set('decision', 'approve');
  return decideIndent(fd);
}
export async function sendBackIndent(fd: FormData) {
  fd.set('decision', 'send_back');
  return decideIndent(fd);
}
export async function rejectIndent(fd: FormData) {
  fd.set('decision', 'reject');
  return decideIndent(fd);
}

// ---- part 3: requisitions to approve, comparative statements to sign ------------------------------
const prDecision = (decision: 'approve' | 'send_back' | 'reject') => async (fd: FormData) => {
  const id = pick(fd, 'id');
  const to = `/purchase/requisitions/${id}`;
  if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  return run(
    to,
    () =>
      apiFetch(`/purchase/requisitions/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ action: decision, note: pick(fd, 'reason') || undefined }),
      }),
    decision === 'approve'
      ? 'Approved'
      : decision === 'reject'
        ? 'Rejected'
        : 'Sent back to the purchase office',
  );
};
export async function approveRequisition(fd: FormData) {
  return prDecision('approve')(fd);
}
export async function sendBackRequisition(fd: FormData) {
  return prDecision('send_back')(fd);
}
export async function rejectRequisition(fd: FormData) {
  return prDecision('reject')(fd);
}
export async function signRequisition(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  return run(
    `/purchase/requisitions/${id}`,
    () =>
      apiFetch(`/purchase/requisitions/${id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ note: pick(fd, 'reason') || undefined }),
      }),
    'You signed the comparative statement',
  );
}
export async function unsignRequisition(fd: FormData) {
  const id = pick(fd, 'id');
  if (!okId(id)) back('/purchase/requisitions', 'validation-failed', 'Unknown requisition');
  return run(
    `/purchase/requisitions/${id}`,
    () => apiFetch(`/purchase/requisitions/${id}/sign`, { method: 'DELETE' }),
    'Your signature withdrawn',
  );
}
