'use server';
/** Reservations at the library (docs/design/36-library.md, "Library round 3", part 4). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const back = (fd: FormData) => {
  const b = pick(fd, 'back');
  return b.startsWith('/library/reservations') ? b : '/library/reservations';
};
const join = (b: string, q: string) => `${b}${b.includes('?') ? '&' : '?'}${q}`;

/** The library cancels a reservation, with the reason; a copy kept for it goes to the next in line. */
export async function cancelReservation(fd: FormData) {
  const id = pick(fd, 'id');
  const reason = pick(fd, 'reason');
  const to = back(fd);
  if (!/^\d{1,18}$/.test(id) || reason.length < 3)
    redirect(join(to, 'error=validation-failed&detail=Give+the+reason'));
  try {
    await apiFetch(`/library/reservations/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        join(
          to,
          `error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(String(e.problem.detail ?? e.problem.type).slice(0, 400))}`,
        ),
      );
    throw e;
  }
  revalidatePath('/library/reservations');
  redirect(join(to, 'ok=1&detail=Reservation+cancelled'));
}
