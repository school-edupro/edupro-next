'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

export async function askParentAssistant(fd: FormData) {
  const language = str(fd, 'language');
  let out: { conversationId: string } | undefined;
  try {
    out = await bff.api.fetch('/insights/assistant', {
      method: 'POST',
      body: JSON.stringify({
        question: str(fd, 'question'),
        conversationId: str(fd, 'conversationId') || undefined,
        language: language || undefined,
        surface: 'parent',
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/assistant?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
      );
    }
    throw error;
  }
  redirect(`/assistant?c=${out!.conversationId}`);
}
