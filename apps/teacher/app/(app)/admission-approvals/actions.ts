'use server';
/** Admission approvers' decisions in the staff app (docs/design/50). */
import { revalidatePath } from 'next/cache';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

type Result = { ok: true } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';

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

/**
 * The approver puts in a document or photo in place of the family's (PDF, PNG, JPEG; 5 MB): an upload
 * slot owned by the registration, the bytes, then the swap with the reason.
 */
export async function approvalReplaceDocument(id: string, fd: FormData): Promise<Result> {
  const key = String(fd.get('key') ?? '');
  const reason = String(fd.get('reason') ?? '').trim();
  const file = fd.get('file');
  if (!okId(id) || !/^[A-Za-z0-9_]{1,80}$/.test(key) || !(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose the file to put in' };
  let fileId: string;
  try {
    const reg = await bff.api.fetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>(`/admissions/approvals/${id}/documents/${key}/slot`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200) || 'file',
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    const target = reg.upload.url.startsWith('http') ? reg.upload.url : `${API}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok) return { ok: false, error: 'The file did not upload; try again' };
    fileId = reg.file.id;
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        error: typeof e.problem.detail === 'string' ? e.problem.detail : e.problem.type,
      };
    throw e;
  }
  return post(`/admissions/approvals/${id}/documents/${key}`, { fileId, reason });
}
