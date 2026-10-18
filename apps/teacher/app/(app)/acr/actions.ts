'use server';
/** Employee ACR in the staff app (docs/design/32-employee-acr.md): my self-appraisal, my levels, my result. */
import { revalidatePath } from 'next/cache';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

type Res = { ok: true } | { ok: false; error: string };
type AnswerMap = Record<string, number | string>;
interface LevelBody {
  answers: AnswerMap;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
}
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
