'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** S10: a class teacher answers or closes queries from the families of their sections. */
export async function respond(fd: FormData) {
  const id = str(fd, 'id');
  const action = str(fd, 'action');
  try {
    if (action === 'close')
      await bff.api.fetch(`/engagement/queries/${id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          decision: str(fd, 'decision') || undefined,
          note: str(fd, 'body') || undefined,
        }),
      });
    else
      await bff.api.fetch(`/engagement/queries/${id}/responses`, {
        method: 'POST',
        body: JSON.stringify({ body: str(fd, 'body'), isInternal: fd.get('isInternal') === 'on' }),
      });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/queries/${id}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect(`/queries/${id}?ok=1`);
}
