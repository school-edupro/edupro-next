'use server';
/** Employee ACR in the staff app (docs/design/32-employee-acr.md): my self-appraisal, my levels, my result. */
import { revalidatePath } from 'next/cache';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

type Res = { ok: true } | { ok: false; error: string };
type AnswerMap = Record<string, number | string | string[]>;
interface LevelBody {
  answers: AnswerMap;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
  remarkIds?: string[];
}
const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
const okId = (id: string) => /^\d{1,18}$/.test(id);
const R = (id: string) => `/people/acr/reports/${id}`;

async function call(
  id: string,
  path: string,
  method: 'POST' | 'PUT',
  body?: unknown,
): Promise<Res> {
  if (!okId(id)) return { ok: false, error: 'Unknown ACR' };
  try {
    await bff.api.fetch(`${R(id)}${path}`, { method, body: JSON.stringify(body ?? {}) });
  } catch (e) {
    if (e instanceof ApiError) {
      const list = e.problem.errors as Array<{ message?: string }> | undefined;
      return {
        ok: false,
        error: list?.length
          ? list.map((x) => x.message).join('; ')
          : (e.problem.detail ?? e.problem.type),
      };
    }
    throw e;
  }
  revalidatePath('/acr');
  return { ok: true };
}

export async function saveSelf(id: string, answers: AnswerMap) {
  return call(id, '/self', 'PUT', { answers });
}
export async function submitSelf(id: string, answers: AnswerMap) {
  return call(id, '/self/submit', 'POST', { answers });
}
export async function saveLevel(id: string, seq: number, body: LevelBody) {
  return call(id, `/levels/${String(seq)}`, 'PUT', body);
}
export async function submitLevel(id: string, seq: number, body: LevelBody) {
  return call(id, `/levels/${String(seq)}/submit`, 'POST', body);
}
export async function sendBack(id: string, reason: string) {
  return call(id, '/send-back', 'POST', { reason });
}
export async function acknowledge(id: string) {
  return call(id, '/acknowledge', 'POST');
}
export async function represent(id: string, text: string) {
  return call(id, '/represent', 'POST', { text });
}

/**
 * A file for an attachment question (0194), uploaded as me: an image or a PDF up to 5 MB. The sheet
 * puts the id on the answer; the API checks the file is mine when the answer is saved.
 */
export async function uploadAcrFile(
  id: string,
  fd: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!okId(id)) return { ok: false, error: 'Unknown ACR' };
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file.' };
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
    return { ok: false, error: `${file.name}: attach a PDF or an image (JPG, PNG, WebP).` };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: `${file.name} is larger than 5 MB.` };
  try {
    const reg = await bff.api.fetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>(`${R(id)}/files`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        sizeBytes: file.size,
        classification: 'personal',
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
    if (!put.ok) return { ok: false, error: `${file.name} did not upload.` };
    return { ok: true, id: reg.file.id };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}
