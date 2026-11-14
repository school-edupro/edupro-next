'use server';
/** Certificate requests in the staff app (docs/design/87, phase C): ask, withdraw, the PDF of an issued one. */
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const okId = (v: string) => /^\d{1,18}$/.test(v);
function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
    );
  }
  throw error;
}

export async function askMyCertificate(fd: FormData) {
  const type = str(fd, 'type');
  try {
    await bff.api.fetch('/certificate-requests/mine', {
      method: 'POST',
      body: JSON.stringify({
        typeCode: type,
        purpose: str(fd, 'purpose'),
        copies: Math.min(10, Math.max(1, Number(str(fd, 'copies')) || 1)),
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    fail(`/my-certificates?ask=${encodeURIComponent(type)}`, error);
  }
  redirect('/my-certificates?asked=1');
}

export async function withdrawMyCertificateRequest(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  try {
    await bff.api.fetch(`/certificate-requests/mine/${id}/withdraw`, { method: 'POST' });
  } catch (error) {
    fail('/my-certificates', error);
  }
  redirect('/my-certificates?withdrawn=1');
}

export async function myCertificatePdf(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  let exportId = '';
  try {
    exportId = (
      await bff.api.fetch<{ exportId: string }>(
        `/certificate-requests/mine/certificates/${id}/pdf`,
        {
          method: 'POST',
        },
      )
    ).exportId;
  } catch (error) {
    fail('/my-certificates', error);
  }
  redirect(`/my-certificates?export=${exportId}`);
}
