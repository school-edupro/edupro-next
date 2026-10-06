'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** A guardian or the student acknowledges homework, a class document or a notice for the child. */
export async function acknowledge(fd: FormData) {
  const back = str(fd, 'back') || '/';
  const safe = /^\/[a-z0-9/?=&_-]*$/i.test(back) ? back : '/';
  try {
    await bff.api.fetch('/academics/acks', {
      method: 'POST',
      body: JSON.stringify({
        type: str(fd, 'type'),
        id: str(fd, 'id'),
        studentId: str(fd, 'studentId'),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        `${safe}${safe.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}`,
      );
    throw error;
  }
  redirect(`${safe}${safe.includes('?') ? '&' : '?'}ack=1`);
}
