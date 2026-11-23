'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** a safe way back: a path of this website only */
const backOf = (fd: FormData) => {
  const b = str(fd, 'back');
  return b.startsWith('/') && !b.startsWith('//') ? b : '/';
};

const withParam = (path: string, extra: string) =>
  `${path}${path.includes('?') ? '&' : '?'}${extra}`;

/**
 * docs/design/98: the class teacher's Done on a section's area the office reopened under the exam lock — it is
 * locked again with the rest of the exam; what was saved stays.
 */
export async function closeAreaEntry(fd: FormData) {
  const back = backOf(fd);
  const area = str(fd, 'area');
  try {
    await bff.api.fetch(`/exams/${str(fd, 'examId')}/area-entry/close`, {
      method: 'POST',
      body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), area }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        withParam(
          back,
          `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
        ),
      );
    }
    throw error;
  }
  redirect(withParam(back, `closed=${encodeURIComponent(area)}`));
}
