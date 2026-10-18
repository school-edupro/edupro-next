'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Mark a topic of the syllabus done, partly done or not done for the section. */
export async function markTopic(status: 'done' | 'partial' | 'not_done', fd: FormData) {
  const here = `/syllabus?section=${str(fd, 'classSectionId')}&subject=${str(fd, 'subjectId')}`;
  try {
    await bff.api.fetch('/academics/syllabus/mark', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        topicId: str(fd, 'topicId'),
        status,
        doneOn: str(fd, 'doneOn') || undefined,
        reason: str(fd, 'reason') || undefined,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${here}&error=1&detail=${encodeURIComponent(detail.slice(0, 200))}#t${str(fd, 'topicId')}`,
      );
    }
    throw error;
  }
  redirect(`${here}&ok=1#t${str(fd, 'topicId')}`);
}
