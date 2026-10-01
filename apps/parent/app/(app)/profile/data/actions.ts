'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 20: a family raises an access, correction or grievance request under the DPDP Act. */
export async function raiseDataRequest(fd: FormData) {
  const kind = ['access', 'correction', 'grievance'].includes(str(fd, 'kind'))
    ? str(fd, 'kind')
    : 'access';
  try {
    await bff.api.fetch('/privacy/requests/mine', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        studentId: str(fd, 'studentId') || undefined,
        detail: str(fd, 'detail'),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/profile/data?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect('/profile/data?ok=1');
}
