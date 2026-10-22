'use server';
/**
 * The Fines page (docs/design/36-library.md, "Library reports", part 1): old fines sent to the fees
 * counter, an old fine waived with its reason, a fine at the counter waived through the fees office.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Back to the page and the filters it came from (only the Fines page itself). */
function back(fd: FormData, extra: Record<string, string>): never {
  const from = pick(fd, 'back');
  const base = /^\/library\/fines(\?[^#]*)?$/.test(from) ? from : '/library/fines';
  const u = new URL(base, 'http://x');
  for (const k of ['ok', 'error', 'detail']) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  redirect(`${u.pathname}?${u.searchParams.toString()}`);
}

async function attempt<T>(fd: FormData, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError)
      back(fd, {
        error: e.problem.type,
        detail: String(e.problem.detail ?? e.problem.type).slice(0, 600),
      });
    throw e;
  }
}

/** Old fines (before they went to the fees counter on return): one, or every one. */
export async function sendFinesToCounter(fd: FormData) {
  const loanId = pick(fd, 'loanId');
  const r = await attempt(fd, () =>
    apiFetch<{ sent: number; total: number }>('/library/fines/send', {
      method: 'POST',
      body: JSON.stringify(okId(loanId) ? { loanIds: [loanId] } : {}),
    }),
  );
  revalidatePath('/library/fines');
  back(fd, {
    ok: '1',
    detail: r.sent
      ? `${String(r.sent)} fine${r.sent === 1 ? '' : 's'} of ${rupees(r.total)} sent to the fees counter as misc fees`
      : 'Nothing was left to send',
  });
}

/** An old fine, still at the library, waived with its reason. */
export async function waiveOldFine(fd: FormData) {
  const loanId = pick(fd, 'loanId');
  if (!okId(loanId)) back(fd, { error: 'not-found', detail: 'Loan not found' });
  const amount = Number(pick(fd, 'amount'));
  await attempt(fd, () =>
    apiFetch(`/library/loans/${loanId}/fine`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'waive',
        amount: pick(fd, 'amount') && Number.isFinite(amount) ? amount : undefined,
        note: pick(fd, 'reason'),
      }),
    }),
  );
  revalidatePath('/library/fines');
  back(fd, { ok: '1', detail: 'The fine is waived; the reason is kept on the Waived tab' });
}

/** A fine at the fees counter: the fees office is asked to waive some or all of it. */
export async function askFineWaiver(fd: FormData) {
  const chargeId = pick(fd, 'chargeId');
  if (!okId(chargeId)) back(fd, { error: 'not-found', detail: 'Fine not found' });
  const amount = Number(pick(fd, 'amount'));
  const r = await attempt(fd, () =>
    apiFetch<{ waive: number }>(`/library/charges/${chargeId}/waive-request`, {
      method: 'POST',
      body: JSON.stringify({
        amount: pick(fd, 'amount') && Number.isFinite(amount) ? amount : undefined,
        reason: pick(fd, 'reason'),
      }),
    }),
  );
  revalidatePath('/library/fines');
  back(fd, {
    ok: '1',
    detail: `The fees office is asked to waive ${rupees(r.waive)}; until it decides, the fine stays due`,
  });
}
