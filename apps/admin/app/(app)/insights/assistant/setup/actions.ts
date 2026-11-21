'use server';
/**
 * Assistant set-up (0410, docs/design/91 phase C): the editor's save. Returns the fresh set-up or the API's words
 * for what is wrong.
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api';
import type { AssistantSetup, AssistantSetupValues } from '@/lib/assistant-setup';

type Result = { ok: true; data: AssistantSetup } | { ok: false; error: string };

export async function saveAssistantSetup(values: AssistantSetupValues): Promise<Result> {
  try {
    const data = await apiFetch<AssistantSetup>('/insights/assistant/settings', {
      method: 'PUT',
      body: JSON.stringify({
        audiences: values.audiences,
        dailyLimit: values.dailyLimit,
        topicsOff: values.topicsOff,
        starters: values.starters,
      }),
    });
    revalidatePath('/insights/assistant/setup');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as unknown;
      const list = Array.isArray(errs)
        ? errs
            .map((e) =>
              typeof e === 'string' ? e : ((e as { message?: string } | null)?.message ?? ''),
            )
            .filter(Boolean)
        : [];
      return {
        ok: false,
        error: list.length ? list.join(' ') : (error.problem.detail ?? error.problem.type),
      };
    }
    throw error;
  }
}
