'use server';
import { redirect } from 'next/navigation';
import { PublicApiError, gateFetch } from '@/lib/api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** A walk-in visitor (mobile confirmed by one-time code) sends their details and waits for the guard. */
export async function registerAtGate(fd: FormData) {
  const school = str(fd, 'school');
  const lang = str(fd, 'lang') || 'en';
  const back = `/${school}/visitor?lang=${lang}`;
  try {
    await gateFetch(`/${encodeURIComponent(school)}`, {
      method: 'POST',
      body: JSON.stringify({
        visitorName: str(fd, 'visitorName'),
        visitorType: str(fd, 'visitorType') || undefined,
        organisation: str(fd, 'organisation') || undefined,
        email: str(fd, 'email') || undefined,
        partySize: Number(str(fd, 'partySize') || 1),
        idProofKind: str(fd, 'idProofKind') || undefined,
        idProofLast4: str(fd, 'idProofLast4') || undefined,
        vehicleNo: str(fd, 'vehicleNo') || undefined,
        equipment: str(fd, 'equipment') || undefined,
        hostId: str(fd, 'hostId') || undefined,
        toMeet: str(fd, 'hostId') ? undefined : str(fd, 'toMeet') || undefined,
        purpose: str(fd, 'purpose'),
        photo: str(fd, 'photo') || undefined,
        consent: fd.get('consent') !== null,
      }),
    });
  } catch (error) {
    if (error instanceof PublicApiError) {
      const errs = error.problem.errors as Array<{ message?: string }> | undefined;
      const detail = Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : (error.problem.detail ?? error.problem.type);
      redirect(`${back}&error=${encodeURIComponent(String(detail).slice(0, 200))}`);
    }
    throw error;
  }
  redirect(`${back}&ok=1`);
}
