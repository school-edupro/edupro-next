'use server';
/**
 * The exam's entry sheets (docs/design/66, phase 2): marks (saved, and submitted in the same step),
 * indicators of every area of a section at once, health, and a section's general remarks with its
 * remarks by category.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function back(path: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(path, 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 200));
  url.searchParams.set('r', Date.now().toString(36));
  revalidatePath(url.pathname);
  redirect(`${url.pathname}${url.search}`);
}
const detailOf = (e: ApiError) => {
  if (typeof e.problem.detail === 'string' && e.problem.detail) return e.problem.detail;
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return Array.isArray(errs)
    ? errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ')
    : undefined;
};
type Out<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(path: string, method: string, body: unknown): Promise<Out<T>> {
  try {
    return { ok: true, data: await apiFetch<T>(path, { method, body: JSON.stringify(body) }) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) ?? e.problem.type };
    throw e;
  }
}

// ---- marks ---------------------------------------------------------------------------------------
export interface MarkRow {
  studentId: string;
  marks: number | null;
  code: string | null;
  grade: string | null;
}

/**
 * The changed rows of a section's subject (or one part of it), then, when asked, the subject submitted
 * for verification (refused while a student who takes it has no mark or code).
 */
export async function saveMarksSheet(input: {
  examId: string;
  classSectionId: string;
  subjectId: string;
  partId: string | null;
  rows: MarkRow[];
  submit: boolean;
}): Promise<Out<null>> {
  const { examId, classSectionId, subjectId, partId, rows } = input;
  if (rows.length) {
    const r = partId
      ? await call(`/exams/${examId}/part-marks`, 'PUT', {
          classSectionId,
          partId,
          rows: rows.map((x) => ({
            studentId: x.studentId,
            marks: x.code === 'AB' ? null : x.marks,
            absent: x.code === 'AB',
          })),
        })
      : await call(`/exams/${examId}/marks`, 'PUT', { classSectionId, subjectId, rows });
    if (!r.ok) return r;
  }
  if (input.submit) {
    const r = await call(`/exams/${examId}/entry-status/submit`, 'POST', {
      classSectionId,
      subjectId,
    });
    if (!r.ok) return r;
  }
  revalidatePath(`/exams/${examId}`, 'layout');
  return { ok: true, data: null };
}

// ---- indicators ------------------------------------------------------------------------------------
/** Changed cells of every area of a section: a level or a note; an emptied cell is taken off. */
export async function saveIndicatorSheet(
  examId: string,
  classSectionId: string,
  rows: Array<{
    studentId: string;
    indicatorId: string;
    grade: string | null;
    note: string | null;
  }>,
): Promise<Out<null>> {
  for (let i = 0; i < rows.length; i += 3000) {
    const r = await call(`/exams/${examId}/indicators`, 'PUT', {
      classSectionId,
      rows: rows.slice(i, i + 3000),
    });
    if (!r.ok) return r;
  }
  revalidatePath(`/exams/${examId}`, 'layout');
  return { ok: true, data: null };
}

// ---- remarks: the general remark and the categories --------------------------------------------------
/**
 * A section's remarks: the general remarks that changed (an emptied one is taken off; "took part in"
 * and "promoted to" stay as they are) and every category cell shown (an emptied one is taken off).
 */
export async function saveRemarksSheet(fd: FormData) {
  const examId = str(fd, 'examId');
  const classSectionId = str(fd, 'classSectionId');
  const backTo = str(fd, 'back') || `/exams/${examId}/remarks`;
  const students = fd.getAll('studentId').map(String);
  const general = students
    .filter((id) => fd.has(`g-${id}`) && str(fd, `g-${id}`) !== str(fd, `g0-${id}`))
    .map((studentId) => ({ studentId, remark: str(fd, `g-${studentId}`) }));
  const cats = fd.getAll('category').map(String);
  const items: Array<{ studentId: string; categoryId: string; text: string | null }> = [];
  for (const studentId of students)
    for (const categoryId of cats) {
      const k = `r-${studentId}-${categoryId}`;
      if (fd.has(k)) items.push({ studentId, categoryId, text: str(fd, k) || null });
    }
  if (!general.length && !items.length) back(backTo, 'validation-failed', 'Nothing to save');
  try {
    if (general.length)
      await apiFetch(`/exams/${examId}/remarks`, {
        method: 'PUT',
        body: JSON.stringify({ classSectionId, rows: general }),
      });
    if (items.length)
      await apiFetch(`/exams/${examId}/remark-items`, {
        method: 'PUT',
        body: JSON.stringify({ classSectionId, rows: items }),
      });
  } catch (error) {
    if (error instanceof ApiError) back(backTo, error.problem.type, detailOf(error));
    throw error;
  }
  back(backTo, 'ok');
}

// ---- health ------------------------------------------------------------------------------------------
const num = (v: string) => (v ? Number(v) : null);

/** Height, weight and blood group measured for the exam: the rows that changed. */
export async function saveHealthSheet(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/health`;
  const fields = ['h', 'w', 'b'] as const;
  const rows = fd
    .getAll('studentId')
    .map(String)
    .filter((id) => fields.some((f) => str(fd, `${f}-${id}`) !== str(fd, `${f}0-${id}`)))
    .map((studentId) => ({
      studentId,
      heightCm: num(str(fd, `h-${studentId}`)),
      weightKg: num(str(fd, `w-${studentId}`)),
      bloodGroup: str(fd, `b-${studentId}`) || null,
    }));
  if (!rows.length) back(backTo, 'validation-failed', 'Nothing changed');
  try {
    await apiFetch(`/exams/${examId}/health`, {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        ...(str(fd, 'recordedOn') ? { recordedOn: str(fd, 'recordedOn') } : {}),
        rows,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) back(backTo, error.problem.type, detailOf(error));
    throw error;
  }
  back(backTo, 'ok');
}
