'use server';
/** Landing page actions: the user's own layout, the role defaults, birthday wishes. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (fd: FormData, k: string) =>
  str(fd, k)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function fail(to: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${to}${to.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 200))}`,
    );
  throw error;
}

/** Saved from the "Arrange my page" panel: widget order, hidden widgets, pinned actions (comma lists). */
export async function saveMyLayout(fd: FormData) {
  try {
    await apiFetch('/dashboard/layout', {
      method: 'PUT',
      body: JSON.stringify({
        widgets: list(fd, 'widgets'),
        hidden: list(fd, 'hidden'),
        quickActions: list(fd, 'quickActions'),
      }),
    });
  } catch (error) {
    fail('/', error);
  }
  revalidatePath('/');
  redirect('/?ok=layout');
}

export async function resetMyLayout() {
  try {
    await apiFetch('/dashboard/layout', { method: 'DELETE' });
  } catch (error) {
    fail('/', error);
  }
  revalidatePath('/');
  redirect('/?ok=reset');
}

export async function wishBirthday(fd: FormData) {
  let out: { channels?: string[] } = {};
  try {
    out = await apiFetch('/dashboard/wish', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind') === 'employee' ? 'employee' : 'student',
        id: str(fd, 'id'),
      }),
    });
  } catch (error) {
    fail('/', error);
  }
  revalidatePath('/');
  redirect(
    `/?ok=wished&detail=${encodeURIComponent(`Wished ${str(fd, 'name')}${out.channels?.length ? ` (${out.channels.join(', ')})` : ' (no app or message channel ready: recorded)'}.`)}`,
  );
}

export async function saveRoleLanding(fd: FormData) {
  const role = str(fd, 'role');
  const to = `/system/landing?role=${encodeURIComponent(role)}`;
  try {
    await apiFetch(`/dashboard/defaults/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify({
        // ticked widgets (w-<key>) in the order of their numbers (o-<key>)
        widgets: [...fd.keys()]
          .filter((k) => k.startsWith('w-'))
          .map((k) => k.slice(2))
          .sort((a, b) => Number(str(fd, `o-${a}`) || 99) - Number(str(fd, `o-${b}`) || 99)),
        quickActions: fd.getAll('qa').map(String),
      }),
    });
  } catch (error) {
    fail(to, error);
  }
  revalidatePath('/system/landing');
  redirect(`${to}&ok=1`);
}
