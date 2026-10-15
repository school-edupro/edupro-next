'use server';
/** System -> Sign-in (0136): how the school's users sign in, and the codes shown on screen. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const PATH = '/system/sign-in';
const back = (q: string) => redirect(`${PATH}?${q}`);

export async function saveSignIn(fd: FormData) {
  const mode = String(fd.get('mode') ?? '');
  const onScreen = fd.get('onScreen') === 'on';
  if (!['oneauth', 'oneauth_otp', 'otp'].includes(mode))
    back('error=1&detail=Choose how users sign in');
  const channels = fd
    .getAll('channels')
    .map(String)
    .filter((v) => ['email', 'whatsapp', 'sms'].includes(v));
  if (channels.length === 0) back('error=1&detail=Tick at least one channel for the code');
  try {
    const id = (k: string) => {
      const v = String(fd.get(k) ?? '');
      return /^\d{1,18}$/.test(v) ? v : '';
    };
    for (const [key, value] of [
      ['auth.login_mode', mode],
      ['auth.otp_on_screen', onScreen],
      ['auth.otp_whatsapp_template', id('waTemplate')],
      ['auth.otp_sms_template', id('smsTemplate')],
      ['auth.otp_channels', channels],
    ] as const)
      await apiFetch(`/platform/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
  } catch (error) {
    if (error instanceof ApiError)
      back(
        `error=1&detail=${encodeURIComponent(String(error.problem.detail ?? error.problem.type))}`,
      );
    throw error;
  }
  back('ok=1');
}

export async function forgetDevices() {
  let n = 0;
  try {
    n = (await apiFetch<{ forgotten: number }>('/auth/otp/forget-devices', { method: 'POST' }))
      .forgotten;
  } catch (error) {
    if (error instanceof ApiError)
      back(
        `error=1&detail=${encodeURIComponent(String(error.problem.detail ?? error.problem.type))}`,
      );
    throw error;
  }
  back(`ok=1&detail=${encodeURIComponent(`${n} remembered device(s) forgotten`)}`);
}
