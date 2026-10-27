'use server';
/** Admission approvers' decisions in the staff app (docs/design/50). */
import { revalidatePath } from 'next/cache';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

type Result = { ok: true } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);

async function post(path: string, body: unknown): Promise<Result> {
  try {
    await bff.api.fetch(path, { method: 'POST', body: JSON.stringify(body) });
    revalidatePath('/admission-approvals');
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) {
      const errs = e.problem.errors as unknown;
      return {
        ok: false,
        error:
          Array.isArray(errs) && errs.length
            ? errs.map(String).join('. ')
            : typeof e.problem.detail === 'string'
              ? e.problem.detail
              : e.problem.type,
      };
    }
    throw e;
  }
}

export async function approvalDecide(
  id: string,
  input: { decision: 'approve' | 'hold' | 'reject'; remarks: string },
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
/** Answers corrected by the approver, with a reason; points and fee category follow (docs/design/51). */
export async function approvalCorrect(
  id: string,
  input: { answers: Record<string, unknown>; reason: string },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown registration' };
  return post(`/admissions/approvals/${id}/correct`, input);
}
