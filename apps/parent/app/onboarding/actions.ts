'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** S11 DPDP onboarding: acknowledge the current notice and record the consent choices in one step. */
export async function acknowledge(fd: FormData) {
  const version = Number(fd.get('version'));
  const consents: Array<{ purposeCode: string; status: 'granted' | 'withdrawn' }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('consent.') || typeof value !== 'string') continue;
    consents.push({
      purposeCode: key.slice(8),
      status: value === 'granted' ? 'granted' : 'withdrawn',
    });
  }
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
