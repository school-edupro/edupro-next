'use server';
import { redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import { careersFetch, type CareerMe, type CareerSaved } from '@/lib/careers';

const okId = (id: string) => /^\d{1,18}$/.test(id);

/** What the API said, in words for the form. */
function problemOf(error: unknown): string {
  if (error instanceof PublicApiError) {
    if (error.status === 401) return 'Your sign-in has ended: sign in again to go on.';
    const list = error.problem.errors as Array<{ message?: string }> | undefined;
    return list?.length
      ? list.map((x) => x.message).join('; ')
      : String(error.problem.detail ?? error.problem.type);
  }
  throw error;
}

/**
 * One step of the form saved (docs/design/34-recruitment.md): the answers of the step, the lists it holds
 * and the interests when it has them. Every answer the API accepts is kept; the ones refused come back by
 * field, with the form as it now stands.
 */
export async function saveCareerStep(input: {
  values: Record<string, string | null>;
  rows?: Record<string, Array<Record<string, string>>>;
  activities?: string[];
}): Promise<CareerSaved> {
  try {
    const r = await careersFetch<{ errors?: Record<string, string> }>('/me/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    const me = await careersFetch<CareerMe>('/me');
    const errors = r.errors ?? {};
    return { ok: Object.keys(errors).length === 0, errors, me };
  } catch (error) {
    return { ok: false, errors: {}, problem: problemOf(error) };
  }
}

/** A document or photo taken off the form. */
export async function removeCareerFile(id: string): Promise<CareerSaved> {
  if (!okId(id)) return { ok: false, errors: {}, problem: 'Not found' };
  try {
    await careersFetch(`/me/files/${id}`, { method: 'DELETE' });
    return { ok: true, errors: {}, me: await careersFetch<CareerMe>('/me') };
  } catch (error) {
    return { ok: false, errors: {}, problem: problemOf(error) };
  }
}

export async function applyCareer(fd: FormData) {
  const school = String(fd.get('school') ?? '');
  const vacancy = String(fd.get('apply') ?? '');
  let number = '';
  try {
    number = (
      await careersFetch<{ number: string }>(`/vacancies/${vacancy}/apply`, {
        method: 'POST',
        body: JSON.stringify({ declaration: fd.get('declaration') === 'yes' }),
      })
    ).number;
  } catch (error) {
    const detail = problemOf(error);
    redirect(
      `/${school}/careers/form${okId(vacancy) ? `?apply=${vacancy}&` : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 600))}`,
    );
  }
  redirect(`/${school}/careers/mine?applied=${encodeURIComponent(number)}`);
}

/**
 * The application sent again, corrected as the school asked (part 8): the parts the school marked are
 * taken from the form as it now stands; the rest stays as first sent.
 */
export async function resendCareer(fd: FormData) {
  const school = String(fd.get('school') ?? '');
  const id = String(fd.get('id') ?? '');
  if (!/^[a-z0-9-]{1,40}$/i.test(school)) redirect('/');
  if (!okId(id)) redirect(`/${school}/careers/mine`);
  let changed: string[] = [];
  try {
    changed = (
      await careersFetch<{ status: string; changed: string[] }>(`/me/applications/${id}/resend`, {
        method: 'POST',
        body: JSON.stringify({ declaration: fd.get('declaration') === 'yes' }),
      })
    ).changed;
  } catch (error) {
    const detail = problemOf(error);
    redirect(
      `/${school}/careers/form?correct=${id}&error=1&detail=${encodeURIComponent(detail.slice(0, 600))}`,
    );
  }
  redirect(
    `/${school}/careers/mine?corrected=${id}&changed=${encodeURIComponent(changed.join(', ').slice(0, 300))}`,
  );
}
