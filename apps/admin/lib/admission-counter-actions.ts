'use server';
/** Fees → Cashier, Admission fees (docs/design/52): Accounts take the registration or admission fee. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const MODES = new Set(['cash', 'upi', 'card', 'cheque', 'dd', 'bank']);

export async function counterCollect(
  id: string,
  input: {
    kind: 'registration' | 'admission';
    mode: string;
    reference?: string;
    instrumentNo?: string;
    instrumentDate?: string;
    bankName?: string;
    receivedOn?: string;
    remarks?: string;
    modeLabel?: string;
  },
): Promise<
  Result<{
    receiptId: string | null;
    receiptNo: string | null;
    number?: string | null;
    admissionNo?: string | null;
  }>
> {
  if (!/^\d{1,18}$/.test(id) || !MODES.has(input.mode))
    return { ok: false, error: 'Choose how the fee was paid' };
  try {
    const data = await apiFetch<{
      receiptId: string | null;
      receiptNo: string | null;
      number?: string | null;
      admissionNo?: string | null;
    }>(`/fees/admission-counter/${id}/collect`, { method: 'POST', body: JSON.stringify(input) });
    revalidatePath('/fees/cashier/admission');
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) {
      const errs = e.problem.errors as unknown;
      return {
        ok: false,
        error:
          Array.isArray(errs) && errs.length
            ? errs.map(String).join('. ')
            : (e.problem.detail ?? e.problem.type),
      };
    }
    throw e;
  }
}
