'use server';
/** My reservations from the staff app (docs/design/36-library.md, "Library round 3", part 4). */
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
const back = (fd: FormData) => {
  const b = str(fd, 'back');
  return /^\/library(\?[a-z0-9=&%+._-]*)?$/i.test(b) ? b : '/library';
};
const join = (b: string, q: string) => `${b}${b.includes('?') ? '&' : '?'}${q}`;

async function send(to: string, path: string, body: unknown, done: string) {
  try {
    await bff.api.fetch(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        join(
          to,
          `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 300))}`,
        ),
      );
    throw error;
  }
  redirect(join(to, `done=${done}`));
}

/** A book reserved for me: every copy is out, the next one back is kept for me. */
export async function reserveBook(fd: FormData) {
  const to = back(fd);
  const borrowerId = str(fd, 'borrowerId');
  const titleId = str(fd, 'titleId');
  if (!okId(borrowerId) || !okId(titleId)) redirect(join(to, 'error=validation-failed'));
  await send(
    to,
    '/library/portal/reservations',
    { borrowerKind: 'employee', borrowerId, titleId },
    'reserved',
  );
}

/** A reservation cancelled. */
export async function cancelBookReservation(fd: FormData) {
  const to = back(fd);
  const id = str(fd, 'id');
  if (!okId(id)) redirect(join(to, 'error=validation-failed'));
  await send(to, `/library/portal/reservations/${id}/cancel`, {}, 'cancelled');
}
