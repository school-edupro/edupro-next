'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 15: PUT the sheet through app.enter_marks; empty marks without AB/EX are skipped. */
export async function saveMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const back = `/marks?exam=${examId}&pick=${encodeURIComponent(str(fd, 'pick'))}`;
  const rows: Array<{
    studentId: string;
    marks?: number | null;
    absent: boolean;
    exempt: boolean;
  }> = [];
  const ids = new Set<string>();
  for (const key of fd.keys())
    if (key.startsWith('marks-') || key.startsWith('absent-') || key.startsWith('exempt-'))
      ids.add(key.slice(key.indexOf('-') + 1));
  for (const studentId of ids) {
    const marks = str(fd, `marks-${studentId}`);
    const absent = fd.get(`absent-${studentId}`) !== null;
    const exempt = fd.get(`exempt-${studentId}`) !== null;
    if (!marks && !absent && !exempt) continue;
    rows.push({ studentId, marks: absent || exempt ? null : Number(marks), absent, exempt });
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
  const ids = new Set<string>();
  for (const key of fd.keys())
    if (key.startsWith('marks-') || key.startsWith('absent-'))
      ids.add(key.slice(key.indexOf('-') + 1));
  for (const studentId of ids) {
    const marks = str(fd, `marks-${studentId}`);
    const absent = fd.get(`absent-${studentId}`) !== null;
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
