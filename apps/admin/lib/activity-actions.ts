'use server';
/** The employee's daily activity log (0095): my day, the review of a log, and the set-up. */
import { redirect } from 'next/navigation';
import { activityEntriesFrom } from '@edupro/ui';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};

async function saveDay(fd: FormData, submit: boolean) {
  const here = `/staff/activity?date=${str(fd, 'date')}`;
  const { entries, problem, leave } = activityEntriesFrom(fd);
  if (problem) redirect(`${here}&error=1&detail=${encodeURIComponent(problem)}`);
  try {
    await apiFetch('/staff/activity/mine', {
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
    fail(here, error);
  }
  redirect(`${here}&ok=${submit ? 'submitted' : 'draft'}`);
}
export async function saveActivityDraft(fd: FormData) {
  return saveDay(fd, false);
}
export async function submitActivityDay(fd: FormData) {
  return saveDay(fd, true);
}

async function review(fd: FormData, action: 'reviewed' | 'returned') {
  const id = str(fd, 'id');
  const here = `/staff/activity/review/${id}`;
  try {
    await apiFetch(`/staff/activity/logs/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail(here, error);
  }
  redirect(`${here}?ok=${action}`);
}
export async function markActivityReviewed(fd: FormData) {
  return review(fd, 'reviewed');
}
export async function sendActivityBack(fd: FormData) {
  return review(fd, 'returned');
}

export async function saveActivitySettings(fd: FormData) {
  try {
    await apiFetch('/staff/activity/setup', {
      method: 'PUT',
      body: JSON.stringify({ cutoffTime: str(fd, 'cutoffTime'), backDays: str(fd, 'backDays') }),
    });
  } catch (error) {
    fail('/staff/activity/setup', error);
  }
  redirect('/staff/activity/setup?ok=1');
}

export async function saveActivityCategory(fd: FormData) {
  try {
    await apiFetch('/staff/activity/categories', {
      method: 'POST',
      body: JSON.stringify({
        id: str(fd, 'id') || undefined,
        name: str(fd, 'name'),
        sortOrder: str(fd, 'sortOrder') || '100',
        status: str(fd, 'status') === 'inactive' ? 'inactive' : 'active',
      }),
    });
  } catch (error) {
    fail('/staff/activity/setup', error);
  }
  redirect('/staff/activity/setup?ok=1');
}

/** The office marks an employee on leave for the day shown on the Review screen. */
export async function markEmployeeLeave(fd: FormData) {
  const here = `/staff/activity/review?date=${str(fd, 'date')}`;
  try {
    await apiFetch('/staff/activity/leave', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: str(fd, 'employeeId'),
        date: str(fd, 'date'),
        kind: str(fd, 'kind') === 'half' ? 'half' : 'full',
        type: str(fd, 'type'),
        reason: str(fd, 'reason') || undefined,
      }),
    });
  } catch (error) {
    fail(here, error);
  }
  redirect(`${here}&ok=leave`);
}
