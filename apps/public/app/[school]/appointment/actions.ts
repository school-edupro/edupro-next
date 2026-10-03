'use server';
import { redirect } from 'next/navigation';
import { PublicApiError, visitFetch } from '@/lib/api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof PublicApiError) {
    const errs = error.problem.errors as Array<{ path?: string; message?: string }> | undefined;
    const detail = Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : (error.problem.detail ?? error.problem.type);
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(String(detail).slice(0, 200))}`,
    );
  }
  throw error;
}

/** An OTP-verified visitor asks for a slot (0059). */
export async function bookVisit(fd: FormData) {
  const school = str(fd, 'school');
  const lang = str(fd, 'lang') || 'en';
  const back = `/${school}/appointment?${new URLSearchParams({
    lang,
    host: str(fd, 'hostId'),
    date: str(fd, 'date'),
  }).toString()}`;
  try {
    await visitFetch(`/${encodeURIComponent(school)}`, {
      method: 'POST',
      body: JSON.stringify({
        hostId: str(fd, 'hostId'),
        startsAt: str(fd, 'startsAt'),
        purpose: str(fd, 'purpose'),
        visitorName: str(fd, 'visitorName'),
        visitorEmail: str(fd, 'visitorEmail') || undefined,
        visitorOrg: str(fd, 'visitorOrg') || undefined,
        partySize: Number(str(fd, 'partySize') || 1),
        idProofKind: str(fd, 'idProofKind') || undefined,
        idProofLast4: str(fd, 'idProofLast4') || undefined,
        photo: str(fd, 'photo') || undefined,
        consent: fd.get('consent') !== null,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`/${school}/appointment?lang=${lang}&ok=booked`);
}

export async function cancelVisit(fd: FormData) {
  const school = str(fd, 'school');
  const lang = str(fd, 'lang') || 'en';
  const back = `/${school}/appointment?lang=${lang}`;
  try {
    await visitFetch(`/${encodeURIComponent(school)}/${encodeURIComponent(str(fd, 'id'))}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=cancelled`);
}
