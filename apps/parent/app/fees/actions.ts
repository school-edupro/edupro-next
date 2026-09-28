'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Sprint 14: a guardian queues the PDF of one of the family's receipts; the page then shows the download. */
export async function queueMyReceiptPdf(fd: FormData) {
  const paymentId = str(fd, 'paymentId');
  const student = str(fd, 'student');
  let exportId = '';
  try {
    const r = await bff.api.fetch<{ exportId: string }>(`/fees/mine/receipts/${paymentId}/pdf`, {
      method: 'POST',
    });
    exportId = r.exportId;
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/fees?student=${encodeURIComponent(student)}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect(`/fees?student=${encodeURIComponent(student)}&export=${exportId}`);
}
