'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** The class teacher (or the next level) approves or rejects a student leave. */
export async function decideLeave(fd: FormData) {
  const id = str(fd, 'id');
  const outcome = str(fd, 'outcome') === 'approved' ? 'approved' : 'rejected';
  try {
    await bff.api.fetch(`/attendance/leaves/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as Record<string, string> | undefined;
      const detail =
        (errs && Object.values(errs).join('; ')) ||
        (typeof error.problem.detail === 'string' ? error.problem.detail : '');
      redirect(
        `/leaves?open=${id}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`/leaves?ok=${outcome}`);
}
