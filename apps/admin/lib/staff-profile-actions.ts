'use server';
/** Staff profile settings and approvals (docs/design/33-people-dashboards.md). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

export async function saveStaffPolicy(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/people/staff-profile/policy', { method: 'PUT', body: JSON.stringify(input) });
  } catch (e) {
    if (e instanceof ApiError) {
      const list = e.problem.errors as Array<{ message?: string; path?: string }> | undefined;
      return {
        ok: false,
        error: list?.length
          ? list.map((x) => `${x.path ?? ''} ${x.message ?? ''}`).join('; ')
          : (e.problem.detail ?? e.problem.type),
      };
    }
    throw e;
  }
  revalidatePath('/people/staff-profile');
  return { ok: true };
}

/** Accept the ticked fields and refuse the rest (a reason when refusing). */
export async function decideStaffChange(fd: FormData) {
  const id = str(fd, 'id');
  const back = str(fd, 'back') || '/people/staff-profile-approvals';
  const keys = fd.getAll('key').map(String);
  const ticked = new Set(fd.getAll('accept').map(String));
  const all = str(fd, 'all');
  const fields = Object.fromEntries(keys.map((k) => [k, all === 'refuse' ? false : ticked.has(k)]));
  if (!okId(id)) redirect(back);
  try {
    await apiFetch(`/people/staff-profile-approvals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ fields, note: str(fd, 'note') || null }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 300))}`,
      );
    throw error;
  }
  revalidatePath('/people/staff-profile-approvals');
  redirect(
    `${back}${back.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent('Decision saved.')}`,
  );
}
