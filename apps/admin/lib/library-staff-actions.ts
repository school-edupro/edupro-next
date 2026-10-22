'use server';
/** Library staff (docs/design/36-library.md, "Library round 3", part 3). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const pick = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

/** A staff member named on a library, or taken off it. */
export async function changeLibraryStaff(fd: FormData) {
  const libraryId = pick(fd, 'libraryId');
  const employeeId = pick(fd, 'employeeId');
  const remove = pick(fd, 'change') === 'remove';
  if (!okId(libraryId) || !okId(employeeId))
    redirect('/library/staff?error=validation-failed&detail=Pick+the+staff+member');
  let done = '';
  try {
    if (remove) {
      await apiFetch('/library/staff/remove', {
        method: 'POST',
        body: JSON.stringify({ libraryId, employeeId }),
      });
      done = 'Taken off the library';
    } else {
      const r = await apiFetch<{ added: boolean; library: string; employee: string }>(
        '/library/staff',
        { method: 'POST', body: JSON.stringify({ libraryId, employeeId }) },
      );
      done = r.added
        ? `${r.employee} now works in ${r.library} (and in no library they are not named on)`
        : `${r.employee} is on ${r.library} already`;
    }
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `/library/staff?error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(String(e.problem.detail ?? e.problem.type).slice(0, 400))}`,
      );
    throw e;
  }
  revalidatePath('/library/staff');
  redirect(`/library/staff?ok=1&detail=${encodeURIComponent(done)}`);
}
