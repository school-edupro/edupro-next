'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { uploadFiles } from '@/lib/upload';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const BACK = '/attendance?view=leave';

function fail(error: unknown, keep = ''): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as
      Array<{ message?: string }> | Record<string, string> | undefined;
    const detail = Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : errs && Object.keys(errs).length
        ? Object.values(errs).join('; ')
        : typeof error.problem.detail === 'string'
          ? error.problem.detail
          : '';
    redirect(
      `${BACK}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 300))}${keep}`,
    );
  }
  throw error;
}

/** A guardian (or the student) applies for leave: the type, the days, the reason and the certificate. */
export async function applyLeave(fd: FormData) {
  // what was typed comes back with a refusal, so the form need not be filled again
  const keep = ['leaveType', 'fromDate', 'toDate', 'reason']
    .map((k) => `&${k}=${encodeURIComponent(str(fd, k).slice(0, 300))}`)
    .join('');
  let number = '';
  try {
    const fileIds = await uploadFiles(fd);
    const r = await bff.api.fetch<{ number: string }>('/attendance/leaves/mine', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        leaveType: str(fd, 'leaveType'),
        fromDate: str(fd, 'fromDate'),
        toDate: str(fd, 'toDate') || str(fd, 'fromDate'),
        reason: str(fd, 'reason'),
        fileIds,
      }),
    });
    number = r.number;
  } catch (error) {
    fail(error, keep);
  }
  redirect(`${BACK}&ok=applied&no=${encodeURIComponent(number)}`);
}

/** Withdraws a leave that waits, or ends an approved one from today. */
export async function cancelLeave(fd: FormData) {
  try {
    await bff.api.fetch(`/attendance/leaves/mine/${str(fd, 'id')}/cancel`, { method: 'POST' });
  } catch (error) {
    fail(error);
  }
  redirect(`${BACK}&ok=cancelled`);
}
