'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/**
 * Sprint 15: PUT the sheet through app.enter_marks. A mark, a grade (grade-only subject) or a marks code
 * (AB, ML, EX, ...; docs/design/65) per pupil; empty rows are skipped.
 */
export async function saveMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const back = `/marks?exam=${examId}&pick=${encodeURIComponent(str(fd, 'pick'))}`;
  const rows: Array<{
    studentId: string;
    marks: number | null;
    code: string | null;
    grade: string | null;
  }> = [];
  for (const studentId of fd.getAll('studentId').map(String)) {
    const marks = str(fd, `marks-${studentId}`);
    const code = str(fd, `code-${studentId}`);
    const grade = str(fd, `grade-${studentId}`);
    if (!marks && !code && !grade) continue;
    rows.push({
      studentId,
      marks: code || grade || !marks ? null : Number(marks),
      code: code || null,
      grade: code ? null : grade || null,
    });
  }
  if (rows.length === 0) redirect(`${back}&error=validation-failed&detail=nothing%20to%20save`);
  let out: { inserted: number; updated: number } | undefined;
  try {
    out = await bff.api.fetch('/exams/' + examId + '/marks', {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        subjectId: str(fd, 'subjectId'),
        rows,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  redirect(
    `${back}&ok=1&detail=${encodeURIComponent(`${out!.inserted} new, ${out!.updated} changed`)}`,
  );
}

/** One part of a subject (Theory, Practical, Physics …): the subject total follows from the parts. */
export async function savePartMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const back = `/marks?exam=${examId}&pick=${encodeURIComponent(str(fd, 'pick'))}`;
  const rows: Array<{ studentId: string; marks: number | null; absent: boolean }> = [];
  for (const studentId of fd.getAll('studentId').map(String)) {
    const marks = str(fd, `marks-${studentId}`);
    const absent = str(fd, `code-${studentId}`) === 'AB';
    // an empty box with no AB clears what was entered for the pupil in this part
    rows.push({ studentId, marks: absent || !marks ? null : Number(marks), absent });
  }
  if (rows.length === 0) redirect(`${back}&error=validation-failed&detail=nothing%20to%20save`);
  try {
    await bff.api.fetch(`/exams/${examId}/part-marks`, {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        partId: str(fd, 'partId'),
        rows,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1`);
}
