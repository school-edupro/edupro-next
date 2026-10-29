'use server';
/**
 * Remark categories and promotion proposals (docs/design/65, part 7): the categories and their
 * remarks in the bank, a section's remarks by category, and sending a result scheme's proposals to
 * People → Promotions with the cards' "Promoted to".
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
async function run(path: string, fn: () => Promise<unknown>, done?: string): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, detailOf(error));
    throw error;
  }
  back(path, 'ok', done);
}

// ---- categories and the bank -------------------------------------------------------------------
export async function saveRemarkCategory(fd: FormData) {
  return run('/exams/remarks', () =>
    apiFetch('/exams/remark-categories', {
      method: 'PUT',
      body: JSON.stringify({
        code: str(fd, 'code').toUpperCase(),
        name: str(fd, 'name'),
        subjectId: str(fd, 'subjectId') || null,
        classIds: fd.getAll('classIds').map(String).filter(Boolean),
        freeText: fd.get('freeText') !== null,
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function saveBankRemark(fd: FormData) {
  return run('/exams/remarks', () =>
    apiFetch('/exams/remark-bank', {
      method: 'PUT',
      body: JSON.stringify({
        entries: [
          {
            code: str(fd, 'code').toUpperCase(),
            text: str(fd, 'text'),
            categoryCode: str(fd, 'categoryCode') || null,
            classId: str(fd, 'classId') || null,
            sortOrder: Number(str(fd, 'sortOrder') || '0'),
            status: str(fd, 'status') || 'active',
          },
        ],
      }),
    }),
  );
}

/** A section's remarks by category: every cell shown is sent (an emptied one is removed). */
export async function saveRemarkItems(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/remarks`;
  const cats = fd.getAll('category').map(String);
  const rows: Array<{ studentId: string; categoryId: string; text: string | null }> = [];
  for (const studentId of fd.getAll('studentId').map(String))
    for (const categoryId of cats) {
      const k = `r-${studentId}-${categoryId}`;
      if (!fd.has(k)) continue;
      rows.push({ studentId, categoryId, text: str(fd, k) || null });
    }
  if (!rows.length) back(backTo, 'validation-failed', 'Nothing to save');
  return run(
    backTo,
    () =>
      apiFetch(`/exams/${examId}/remark-items`, {
        method: 'PUT',
        body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), rows }),
      }),
    'Remarks saved',
  );
}

// ---- promotion -----------------------------------------------------------------------------------
export async function sendPromotions(fd: FormData) {
  const schemeId = str(fd, 'schemeId');
  const backTo = str(fd, 'back') || `/exams/schemes/${schemeId}/promotion`;
  const toYearId = str(fd, 'toYearId') || null;
  const rows = fd
    .getAll('studentId')
    .map(String)
    .filter((id) => fd.get(`x-${id}`) !== null)
    .map((studentId) => ({
      studentId,
      decision: str(fd, `d-${studentId}`),
      toClassSectionId: str(fd, `s-${studentId}`) || null,
      promotedTo: str(fd, `t-${studentId}`) || null,
    }));
  if (!rows.length) back(backTo, 'validation-failed', 'Tick the students to send');
  let out: { decisions: number; cards: number } | undefined;
  try {
    out = await apiFetch<{ decisions: number; cards: number }>(
      `/exams/schemes/${schemeId}/promotion`,
      { method: 'POST', body: JSON.stringify({ toYearId, rows }) },
    );
  } catch (error) {
    if (error instanceof ApiError) back(backTo, error.problem.type, detailOf(error));
    throw error;
  }
  back(
    backTo,
    'ok',
    `${String(out!.decisions)} promotion decisions and ${String(out!.cards)} cards changed`,
  );
}

// ---- exam attendance (the office corrects it) ---------------------------------------------------
/** Days present and working days per student of a section (empty rows skipped). */
export async function saveExamAttendance(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/attendance`;
  const rows = fd
    .getAll('studentId')
    .map(String)
    .filter((id) => str(fd, `p-${id}`) !== '' && str(fd, `t-${id}`) !== '')
    .map((studentId) => ({
      studentId,
      daysPresent: Number(str(fd, `p-${studentId}`)),
      daysTotal: Number(str(fd, `t-${studentId}`)),
    }));
  if (!rows.length) back(backTo, 'validation-failed', 'Nothing to save');
  return run(backTo, () =>
    apiFetch(`/exams/${examId}/attendance`, {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), rows }),
    }),
  );
}

/** Exam attendance counted from daily attendance between two dates. */
export async function countExamAttendance(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/attendance`;
  let out: { filled: number; kept: number; from: string; to: string } | undefined;
  try {
    out = await apiFetch(`/exams/${examId}/attendance/from-daily`, {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        ...(str(fd, 'from') ? { from: str(fd, 'from') } : {}),
        ...(str(fd, 'to') ? { to: str(fd, 'to') } : {}),
        overwrite: fd.get('overwrite') !== null,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) back(backTo, error.problem.type, detailOf(error));
    throw error;
  }
  back(
    backTo,
    'ok',
    `${String(out!.filled)} counted (${out!.from} to ${out!.to}), ${String(out!.kept)} kept as entered`,
  );
}
