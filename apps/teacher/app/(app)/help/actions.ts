'use server';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';

/** "Was this helpful?" on a Help answer: once per question, a second answer replaces the first. */
export async function voteHelp(fd: FormData) {
  const id = String(fd.get('id') ?? '');
  const q = String(fd.get('q') ?? '').slice(0, 100);
  if (!/^\d{1,18}$/.test(id)) redirect('/help');
  await bff.api
    .fetch(`/engagement/help/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ helpful: fd.get('helpful') === 'yes' }),
    })
    .catch(() => null);
  const back = new URLSearchParams({ open: id });
  if (q) back.set('q', q);
  redirect(`/help?${back.toString()}#q-${id}`);
}
