'use server';
import { revalidatePath } from 'next/cache';
import { bff } from '@/lib/bff';

/** Marks the copies of one message read (opened in the app). Best effort. */
export async function markMessageRead(ids: string[]): Promise<void> {
  try {
    await bff.api.fetch('/comms/inbox/read', { method: 'POST', body: JSON.stringify({ ids }) });
    revalidatePath('/', 'layout');
  } catch {
    // the badge catches up on the next visit
  }
}
