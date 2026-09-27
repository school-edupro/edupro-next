'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** S9-06: the teacher marks a day (class teacher) or subject (subject teacher) session for one date. */
export async function markAttendance(fd: FormData) {
  const classSectionId = str(fd, 'classSectionId');
  const subjectId = str(fd, 'subjectId');
  const date = str(fd, 'date');
  const back = `/attendance?section=${classSectionId}${subjectId ? `&subject=${subjectId}` : ''}&date=${date}`;
  const marks: Array<{ studentId: string; code: string; remarks?: string }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('code-') || typeof value !== 'string' || !value) continue;
    const studentId = key.slice(5);
    const remarks = str(fd, `remarks-${studentId}`);
    marks.push({ studentId, code: value, remarks: remarks || undefined });
  }
  try {
    await bff.api.fetch('/attendance/sessions', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId,
        date,
        kind: subjectId ? 'subject' : 'day',
        subjectId: subjectId || undefined,
        marks,
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
  redirect(`${back}&ok=1`);
}
