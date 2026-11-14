'use server';
/** Certificate requests from the parent app (docs/design/87, phase C): ask, withdraw, a PDF of an issued one. */
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

/** Ask for a certificate for the chosen child (or oneself). */
export async function askCertificate(fd: FormData) {
  const type = str(fd, 'type');
  const back = `/certificates?ask=${encodeURIComponent(type)}`;
  try {
    await bff.api.fetch('/certificate-requests/mine', {
      method: 'POST',
      body: JSON.stringify({
        typeCode: type,
        ...(okId(str(fd, 'studentId')) ? { studentId: str(fd, 'studentId') } : {}),
        purpose: str(fd, 'purpose'),
        copies: Math.min(10, Math.max(1, Number(str(fd, 'copies')) || 1)),
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect('/certificates?asked=1');
}

export async function withdrawCertificateRequest(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  try {
    await bff.api.fetch(`/certificate-requests/mine/${id}/withdraw`, { method: 'POST' });
  } catch (error) {
    fail('/certificates', error);
  }
  redirect('/certificates?withdrawn=1');
}

/** The PDF of an issued certificate: made for the asker, then opened from the page. */
export async function registerCertificatePdf(fd: FormData) {
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
    fail('/certificates', error);
  }
  redirect(`/certificates?cexport=${exportId}`);
}
