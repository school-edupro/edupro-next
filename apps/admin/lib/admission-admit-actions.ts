'use server';
/** Admission fee, Admit and cancellation of online admission (docs/design/39, part 6). */
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
const regPaths = (id: string) => [
  `/admissions/registrations/${id}`,
  '/admissions/registrations',
  '/admissions/admit',
];

export async function collectAdmissionFee(
  id: string,
  body: {
    mode: string;
    reference?: string;
    instrumentNo?: string;
    bankName?: string;
    /** a part (docs/design/53); none: the whole balance */
    amount?: number;
  },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call<{ receiptNo: string | null; admissionNo: string | null; balance?: number }>(
    `/admissions/registrations/${id}/admission-fee`,
    'POST',
    body,
    regPaths(id),
  );
}
export async function admitRegistration(
  id: string,
  body: { classSectionId: string; rollNo?: number; joinedOn?: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call<{ admissionNo: string; section: string; skipped: Record<string, string> }>(
    `/admissions/registrations/${id}/admit`,
    'POST',
    body,
    regPaths(id),
  );
}
export async function admitBulk(
  items: Array<{ applicationId: string; classSectionId: string }>,
  joinedOn?: string,
) {
  return call<{
    admitted: number;
    results: Array<{ applicationId: string; ok: boolean; error?: string }>;
  }>('/admissions/admit-bulk', 'POST', { items, ...(joinedOn ? { joinedOn } : {}) }, [
    '/admissions/admit',
    '/admissions/registrations',
  ]);
}
export async function cancelRegistration(id: string, reason: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return call<{ status: string; refund: { amount: number } | null }>(
    `/admissions/registrations/${id}/cancel`,
    'POST',
    { reason },
    [...regPaths(id), '/admissions/refunds'],
  );
}
export async function decideAdmissionRefund(id: string, approve: boolean, note?: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown refund' };
  return call(`/admissions/refunds/${id}/decide`, 'POST', { approve, ...(note ? { note } : {}) }, [
    '/admissions/refunds',
    '/fees/refunds/admission',
  ]);
}
export async function payAdmissionRefund(
  id: string,
  body: { mode: string; reference?: string; paidOn?: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown refund' };
  return call(`/admissions/refunds/${id}/pay`, 'POST', body, [
    '/admissions/refunds',
    '/fees/refunds/admission',
  ]);
}
