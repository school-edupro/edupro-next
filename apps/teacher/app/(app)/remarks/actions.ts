'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** A section's remarks by category (docs/design/65 part 7): every cell shown is sent. */
export async function saveRemarkItems(fd: FormData) {
  const back = `/remarks?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}`;
  const cats = fd.getAll('category').map(String);
  const rows: Array<{ studentId: string; categoryId: string; text: string | null }> = [];
  for (const studentId of fd.getAll('studentId').map(String))
    for (const categoryId of cats) {
      const k = `r-${studentId}-${categoryId}`;
      if (fd.has(k)) rows.push({ studentId, categoryId, text: str(fd, k) || null });
    }
  if (!rows.length) redirect(`${back}&error=validation-failed`);
  let changed = 0;
  try {
    changed = (
      await bff.api.fetch<{ changed: number }>(`/exams/${str(fd, 'examId')}/remark-items`, {
        method: 'PUT',
        body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), rows }),
      })
    ).changed;
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1&detail=${String(changed)}`);
}
