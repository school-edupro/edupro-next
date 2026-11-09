'use server';
/** Staff attendance in the staff app (docs/design/85, phase C): ask for a correction, withdraw it, decide one. */
import { ApiError } from '@edupro/bff';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const okDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const hm = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
};
const detailOf = (e: ApiError) => {
  const errs = e.problem.errors as Array<{ message?: string }> | Record<string, string> | undefined;
  const first = Array.isArray(errs)
    ? errs.map((x) => x.message).find(Boolean)
    : errs
      ? Object.values(errs)[0]
      : undefined;
  return (typeof e.problem.detail === 'string' ? e.problem.detail : '') || first || e.problem.type;
};
/** Only this app's own pages: a back path from the form, else the list. */
const backOf = (fd: FormData, fallback: string) => {
  const b = String(fd.get('back') ?? '');
  return /^\/(my-attendance|attendance-corrections)(\/[\w-]*)?(\?[\w=&%-]*)?$/.test(b)
    ? b
    : fallback;
};

async function post(path: string, body: unknown, back: string, done: string) {
  try {
    await bff.api.fetch(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(detailOf(e).slice(0, 300))}`,
      );
    throw e;
  }
  revalidatePath('/my-attendance');
  revalidatePath('/attendance-corrections');
  redirect(`${back}${back.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(done)}`);
}

export async function askCorrection(fd: FormData) {
  const day = String(fd.get('day') ?? '');
  if (!okDay(day)) return;
  const type = String(fd.get('dayType') ?? '');
  await post(
    '/staff-attendance/regularisations',
    {
      day,
      in: hm(fd, 'in'),
      out: hm(fd, 'out'),
      dayType: ['P', 'HD', 'WO', 'H'].includes(type) ? type : null,
      reason: String(fd.get('reason') ?? '').trim(),
    },
    `/my-attendance/${day}`,
    'The correction is sent to your approver.',
  );
}

export async function withdrawCorrection(id: string, fd: FormData) {
  if (!okId(id)) return;
  await post(
    `/staff-attendance/regularisations/${id}/withdraw`,
    { reason: '' },
    backOf(fd, '/my-attendance'),
    'Withdrawn.',
  );
}

export async function decideCorrection(id: string, fd: FormData) {
  if (!okId(id)) return;
  const outcome = fd.get('outcome') === 'rejected' ? 'rejected' : 'approved';
  await post(
    `/staff-attendance/regularisations/${id}/decide`,
    { outcome, note: String(fd.get('note') ?? '').trim() },
    backOf(fd, '/attendance-corrections'),
    outcome === 'approved' ? 'Approved: the day is set.' : 'Not approved: the employee is told.',
  );
}
