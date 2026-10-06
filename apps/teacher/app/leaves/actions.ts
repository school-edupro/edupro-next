'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** The class teacher (or the next level) approves or rejects a student leave. */
async function decideLeave(fd: FormData, outcome: 'approved' | 'rejected') {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/attendance/leaves/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as
        Array<{ message?: string }> | Record<string, string> | undefined;
      const detail =
        (Array.isArray(errs)
          ? errs
              .map((e) => e.message)
              .filter(Boolean)
              .join('; ')
          : errs && Object.values(errs).join('; ')) ||
        (typeof error.problem.detail === 'string' ? error.problem.detail : '');
      redirect(
        `/leaves?open=${id}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`/leaves?ok=${outcome}`);
}

// each button has its own action: the decision does not depend on the browser sending the button's value
export async function approveLeave(fd: FormData) {
  return decideLeave(fd, 'approved');
}
export async function rejectLeave(fd: FormData) {
  return decideLeave(fd, 'rejected');
}
