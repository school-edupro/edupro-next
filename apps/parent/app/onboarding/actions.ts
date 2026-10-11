'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * First sign-in (DPDP): the notice is acknowledged and the consent choices are recorded together.
 * Every optional purpose shown on the page is sent: switched on is granted, left off is not given.
 */
export async function acknowledge(fd: FormData) {
  const version = Number(fd.get('version'));
  if (fd.get('accept') !== 'yes') redirect('/onboarding?error=accept');
  const consents = fd
    .getAll('purpose')
    .filter((x): x is string => typeof x === 'string' && /^[a-z0-9_.]{1,60}$/.test(x))
    .map((code) => ({
      purposeCode: code,
      status:
        fd.get(`consent.${code}`) === 'granted' ? ('granted' as const) : ('withdrawn' as const),
    }));
  try {
    await bff.api.fetch('/engagement/onboarding/acknowledge', {
      method: 'POST',
      body: JSON.stringify({ version, consents }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(`/onboarding?error=${encodeURIComponent(error.problem.type)}`);
    throw error;
  }
  redirect('/?welcome=1');
}
