'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/**
 * A section's subject choices from the class teacher (docs/design/67): each student's stream, the
 * subject of each group and the other subjects ticked. A new stream takes the old one's subjects off;
 * the compulsory subjects and the stream's are added by the server.
 */
export async function saveChoices(fd: FormData) {
  const section = str(fd, 'classSectionId');
  const back = `/subject-choices?section=${section}`;
  const streamSubjects = new Map(
    fd
      .getAll('streamName')
      .map(String)
      .map((name) => [name, str(fd, `ss-${name}`).split(',').filter(Boolean)] as const),
  );
  const groups = fd.getAll('groupId').map(String);
  const rows = fd
    .getAll('studentId')
    .map(String)
    .map((studentId) => {
      const stream = str(fd, `stream-${studentId}`);
      const before = str(fd, `stream0-${studentId}`);
      const marked = str(fd, `marked-${studentId}`).split(',').filter(Boolean);
      // the student's own additional subject (the old "Opt")
      const opt = str(fd, `opt-${studentId}`);
      let ids = [
        ...groups.flatMap((g) => fd.getAll(`g-${studentId}-${g}`).map(String)),
        ...fd.getAll(`f-${studentId}`).map(String),
      ].filter(Boolean);
      // a subject with marks stays (a student left without choices takes every subject anyway)
      if (ids.length || stream || fd.get(`set-${studentId}`) === '1') ids.push(...marked);
      if (before && before !== stream) {
        const old = streamSubjects.get(before) ?? [];
        const keep = streamSubjects.get(stream) ?? [];
        ids = ids.filter((id) => !old.includes(id) || keep.includes(id) || marked.includes(id));
      }
      return {
        studentId,
        stream: stream || null,
        subjects: [...new Set(ids)].map((subjectId) => ({
          subjectId,
          additional: subjectId === opt,
        })),
      };
    });
  if (!rows.length) redirect(`${back}&error=validation-failed`);
  try {
    await bff.api.fetch('/exams/subject-choices', {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: section, rows }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1`);
}

/** Students without choices take their last year's subjects and stream. */
export async function bringLastYear(fd: FormData) {
  const section = str(fd, 'classSectionId');
  const back = `/subject-choices?section=${section}`;
  let copied = 0;
  try {
    copied = (
      await bff.api.fetch<{ copied: number }>('/exams/subject-choices/last-year', {
        method: 'POST',
        body: JSON.stringify({ classSectionId: section }),
      })
    ).copied;
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1&copied=${String(copied)}`);
}
