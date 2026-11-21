'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { audienceOf } from '@/components/FamilyShell';
import { bff } from '@/lib/bff';

const PAGE = '/home/shortcuts';

/** What the API said was wrong, in one line. */
function problems(error: ApiError): string {
  const errs = error.problem.errors;
  return Array.isArray(errs) ? errs.map(String).join(' ') : (error.problem.detail ?? '');
}

/** My own Home shortcuts (docs/design/90): the list as the page has it, in its order. */
export async function saveShortcuts(fd: FormData) {
  const list = String(fd.get('shortcuts') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const me = await bff.api.me();
  try {
    await bff.api.fetch(`/me/app-layout/shortcuts?kind=${audienceOf(me)}`, {
      method: 'PUT',
      body: JSON.stringify({ shortcuts: list }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const back = new URLSearchParams({ s: list.join(','), error: problems(error).slice(0, 300) });
      redirect(`${PAGE}?${back.toString()}`);
    }
    throw error;
  }
  redirect(`${PAGE}?ok=saved`);
}

/** Back to the school's Home shortcuts. */
export async function resetShortcuts() {
  const me = await bff.api.me();
  await bff.api.fetch(`/me/app-layout/shortcuts?kind=${audienceOf(me)}`, { method: 'DELETE' });
  redirect(`${PAGE}?ok=reset`);
}
