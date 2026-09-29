'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 22: a teacher reports a hypercare issue from the app. */
export async function reportIssue(fd: FormData) {
  try {
    await bff.api.fetch('/ops/hypercare/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: str(fd, 'title'),
        detail: str(fd, 'detail') || undefined,
        module: str(fd, 'module') || 'apps',
        severity: str(fd, 'severity') || 's3',
        channel: 'teacher_app',
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/issues?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect('/issues?ok=1');
}
