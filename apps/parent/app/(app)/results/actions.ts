'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 17: a guardian queues the PDF of a child's released report card; the page shows the download. */
export async function queueMyReportCardPdf(fd: FormData) {
  const releaseId = str(fd, 'releaseId');
  const studentId = str(fd, 'studentId');
  let exportId = '';
  try {
    const r = await bff.api.fetch<{ exportId: string }>(
      `/exams/mine/report-cards/${releaseId}/${studentId}/pdf`,
      { method: 'POST' },
    );
    exportId = r.exportId;
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/results?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect(`/results?export=${exportId}`);
}
