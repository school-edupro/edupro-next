'use server';
/** Staff leave in the staff app (docs/design/85): apply, decide, withdraw, ask to cancel. */
import { ApiError } from '@edupro/bff';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import type { ApplyResult } from '@/lib/leave';
import { uploadFiles } from '@/lib/upload';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const detailOf = (e: ApiError) => {
  const errs = e.problem.errors as Array<{ message?: string }> | Record<string, string> | undefined;
  const first = Array.isArray(errs)
    ? errs.map((x) => x.message).find(Boolean)
    : errs
      ? Object.values(errs)[0]
      : undefined;
  return (typeof e.problem.detail === 'string' ? e.problem.detail : '') || first || e.problem.type;
};

/** Apply for my leave: the leave made, or the school's question (the sandwich, the loss of pay) first. */
export async function applyMyLeave(fd: FormData): Promise<ApplyResult> {
  try {
    const kept = String(fd.get('documentFileId') ?? '');
    const documentFileId = okId(kept) ? kept : ((await uploadFiles(fd, 'document'))[0] ?? null);
    const halfDay = fd.get('halfDay') === 'on';
    const r = await bff.api.fetch<
      | { confirm: { kind: 'bridge' | 'split'; message: string } }
      | Omit<Extract<ApplyResult, { ok: true }>, 'ok'>
    >('/leave/apply', {
      method: 'POST',
      body: JSON.stringify({
        leaveTypeId: String(fd.get('leaveTypeId') ?? ''),
        from: String(fd.get('from') ?? ''),
        to: halfDay ? String(fd.get('from') ?? '') : String(fd.get('to') ?? ''),
        halfDay,
        session: halfDay ? (fd.get('session') === 'second' ? 'second' : 'first') : null,
        reason: String(fd.get('reason') ?? '').trim(),
        documentFileId,
        bridgeOk: fd.get('bridgeOk') === '1',
        splitOk: fd.get('splitOk') === '1',
      }),
    });
    if ('confirm' in r)
      return { ok: 'confirm', kind: r.confirm.kind, message: r.confirm.message, documentFileId };
    revalidatePath('/my-leave');
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

async function act(id: string, path: string, body: unknown, done: string) {
  if (!okId(id)) return;
  try {
    await bff.api.fetch(`/leave/requests/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `/my-leave/${id}?error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(detailOf(e).slice(0, 300))}`,
      );
    throw e;
  }
  revalidatePath('/my-leave');
  revalidatePath('/leave-approvals');
  redirect(`/my-leave/${id}?ok=1&detail=${encodeURIComponent(done)}`);
}

export async function decideMyLeave(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await act(
    id,
    'decide',
    { outcome, note: String(fd.get('note') ?? '').trim() },
    outcome === 'approved' ? 'Approved.' : 'Not approved: the employee is told.',
  );
}
export async function decideMyLeaveCancel(id: string, fd: FormData) {
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await act(
    id,
    'cancel-decide',
    { outcome, note: String(fd.get('note') ?? '').trim() },
    outcome === 'approved' ? 'The cancellation is approved.' : 'The cancellation is not approved.',
  );
}
export async function withdrawMyLeave(id: string, fd: FormData) {
  await act(
    id,
    'withdraw',
    { reason: String(fd.get('reason') ?? '').trim() },
    'Withdrawn: the days are given back.',
  );
}
export async function askCancelMyLeave(id: string, fd: FormData) {
  await act(
    id,
    'cancel-request',
    { reason: String(fd.get('reason') ?? '').trim() },
    'The cancellation is sent to your approvers.',
  );
}
