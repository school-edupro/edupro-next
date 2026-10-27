'use server';
/** Admission approvers' decisions (docs/design/50). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Result = { ok: true } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

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
    const reg = await apiFetch<{
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

// ---- decisions by Excel (docs/design/55) -------------------------------------------------------
export interface SheetResult {
  place: string;
  applied: boolean;
  ok: number;
  done: number;
  skipped: number;
  errors: number;
  rows: Array<{
    row: number;
    number: string;
    candidate: string | null;
    decision: string | null;
    status: 'ok' | 'skipped' | 'error' | 'done';
    reason: string | null;
  }>;
}
const problem = (e: unknown) =>
  e instanceof ApiError ? String(e.problem.detail ?? e.problem.type) : null;

/** The approval sheet of one level ("cycle:class:stage:level"), to save in the browser. */
export async function approvalSheet(
  place: string,
): Promise<
  | { ok: true; data: { filename: string; contentType: string; base64: string; rows: number } }
  | { ok: false; error: string }
> {
  const m = /^(\d{1,18}):(\d{1,18}):(\d{1,18}):(\d{1,2})$/.exec(place);
  if (!m) return { ok: false, error: 'Choose the stage and level' };
  try {
    const q = new URLSearchParams({ cycleId: m[1]!, classId: m[2]!, stageId: m[3]!, level: m[4]! });
    const data = await apiFetch<{
      filename: string;
      contentType: string;
      base64: string;
      rows: number;
    }>(`/admissions/approvals/sheet?${q.toString()}`);
    return { ok: true, data };
  } catch (e) {
    const p = problem(e);
    if (p) return { ok: false, error: p };
    throw e;
  }
}

/** The filled sheet checked (apply = false) or decided (apply = true). */
export async function approvalSheetUpload(
  fd: FormData,
): Promise<{ ok: true; data: SheetResult } | { ok: false; error: string }> {
  const file = fd.get('file');
  const apply = fd.get('apply') === '1';
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose the filled sheet' };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: 'The sheet must be an .xlsx file' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'The sheet is larger than 5 MB' };
  try {
    const data = await apiFetch<SheetResult>(
      `/admissions/approvals/sheet${apply ? '?apply=1' : ''}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: Buffer.from(await file.arrayBuffer()),
      },
    );
    if (apply) revalidatePath('/admissions/approvals');
    return { ok: true, data };
  } catch (e) {
    const p = problem(e);
    if (p) return { ok: false, error: p };
    throw e;
  }
}
