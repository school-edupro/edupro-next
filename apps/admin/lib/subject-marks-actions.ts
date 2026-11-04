'use server';
/**
 * The subject marks master (docs/design/70): an exam type's subjects and marks per class. The editor
 * saves through saveSubjectMarks ({ ok, data } or { ok: false, error }); copying, filling from an exam
 * and last year's lists are forms that come back to the page with what was done.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
export interface SubjectMarksRow {
  subjectId: string;
  code: string;
  name: string;
  max: number;
  pass: number | null;
  scaleId: string | null;
  scaleCode: string | null;
  optional: boolean;
  /** the subject above it in the subject master */
  parentId: string | null;
  /** a part of that subject, not a paper of its own */
  isPart: boolean;
}
const PAGE = '/exams/subject-marks';
const okId = (v: string) => /^\d{1,18}$/.test(v);
const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const detailOf = (e: ApiError) => {
  if (typeof e.problem.detail === 'string' && e.problem.detail) return e.problem.detail;
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return Array.isArray(errs)
    ? errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ')
    : e.problem.type;
};
function back(query: Record<string, string>, status: 'ok' | string, detail?: string): never {
  const q = new URLSearchParams(query);
  q.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) q.set('detail', detail.slice(0, 300));
  revalidatePath(PAGE);
  redirect(`${PAGE}?${q.toString()}`);
}
async function act<T>(
  query: Record<string, string>,
  fn: () => Promise<T>,
  said: (r: T) => string,
): Promise<never> {
  let r: T;
  try {
    r = await fn();
  } catch (e) {
    if (e instanceof ApiError) back(query, e.problem.type, detailOf(e));
    throw e;
  }
  back(query, 'ok', said(r));
}

export async function saveSubjectMarks(body: {
  typeId: string;
  classId: string;
  rows: Array<
    Pick<SubjectMarksRow, 'subjectId' | 'max' | 'pass' | 'scaleId' | 'optional' | 'isPart'>
  >;
}): Promise<Out<{ rows: SubjectMarksRow[] }>> {
  if (!okId(body.typeId) || !okId(body.classId)) return { ok: false, error: 'Unknown list' };
  try {
    const data = await apiFetch<{ rows: SubjectMarksRow[] }>('/exams/subject-marks', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}

export async function copySubjectMarks(fd: FormData) {
  const typeId = str(fd, 'typeId');
  const classId = str(fd, 'classId');
  const query = { type: typeId, class: classId };
  const toClassIds = fd.getAll('toClassId').map(String).filter(okId);
  const toTypeIds = fd.getAll('toTypeId').map(String).filter(okId);
  return act(
    query,
    () =>
      apiFetch<{ data: Array<{ to: string; copied: number; left: string[] }> }>(
        '/exams/subject-marks/copy',
        { method: 'POST', body: JSON.stringify({ typeId, classId, toClassIds, toTypeIds }) },
      ),
    (r) =>
      `Copied to ${r.data
        .map(
          (x) =>
            `${x.to} (${String(x.copied)}${x.left.length ? `; not studied there (or a part whose subject is not): ${x.left.join(', ')}` : ''})`,
        )
        .join(', ')}`,
  );
}

export async function fillSubjectMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const query = { type: str(fd, 'typeId'), class: str(fd, 'classId') };
  return act(
    query,
    () =>
      apiFetch<{ typeId: string; data: Array<{ code: string; subjects: number }> }>(
        '/exams/subject-marks/fill',
        { method: 'POST', body: JSON.stringify({ examId }) },
      ),
    (r) =>
      r.data.length
        ? `Filled from the exam: ${r.data.map((x) => `${x.code} (${String(x.subjects)})`).join(', ')}`
        : 'The exam has no subjects set yet',
  );
}

export async function lastYearSubjectMarks(fd: FormData) {
  const typeId = str(fd, 'typeId');
  const query = { type: typeId, class: str(fd, 'classId') };
  return act(
    query,
    () =>
      apiFetch<{ from: string; added: number }>('/exams/subject-marks/last-year', {
        method: 'POST',
        body: JSON.stringify(okId(typeId) ? { typeId } : {}),
      }),
    (r) => `${String(r.added)} subject(s) copied from ${r.from}; what was set already stays`,
  );
}
