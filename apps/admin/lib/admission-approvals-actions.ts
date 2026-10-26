'use server';
/** Admission approvers' decisions (docs/design/50). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Result = { ok: true } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);

async function post(path: string, body: unknown): Promise<Result> {
  try {
    await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    revalidatePath('/admissions/approvals');
    return { ok: true };
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

export async function approvalDecide(
  id: string,
  input: { decision: 'approve' | 'hold' | 'reject'; remarks: string; categoryId?: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return post(`/admissions/approvals/${id}/decide`, input);
}
export async function approvalSendBack(
  id: string,
  input: { fields: string[]; remark: string; dueOn?: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return post(`/admissions/approvals/${id}/send-back`, input);
}
export async function approvalPoints(
  id: string,
  input: { action: 'confirm'; lines: Array<{ name: string; points: number; reason?: string }> },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return post(`/admissions/approvals/${id}/points`, input);
}
