'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { activityEntriesFrom } from '@edupro/ui';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

async function save(fd: FormData, submit: boolean) {
  const here = `/activity-log?date=${str(fd, 'date')}`;
  const { entries, problem, leave } = activityEntriesFrom(fd);
  if (problem) redirect(`${here}&error=1&detail=${encodeURIComponent(problem)}`);
  try {
    await bff.api.fetch('/staff/activity/mine', {
      method: 'PUT',
      body: JSON.stringify({
        date: str(fd, 'date'),
        entries,
        tomorrowPlan: str(fd, 'tomorrowPlan') || undefined,
        pendingNote: str(fd, 'pendingNote') || undefined,
        leave,
        submit,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as Array<{ message?: string }> | undefined;
      const detail =
        (Array.isArray(errs)
          ? errs
              .map((e) => e.message)
              .filter(Boolean)
              .join('; ')
          : '') || (typeof error.problem.detail === 'string' ? error.problem.detail : '');
      redirect(`${here}&error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`);
    }
    throw error;
  }
  redirect(`${here}&ok=${submit ? 'submitted' : 'draft'}`);
}

/** Each button of the day has its own action. */
export async function saveActivityDraft(fd: FormData) {
  return save(fd, false);
}
export async function submitActivityDay(fd: FormData) {
  return save(fd, true);
}
