'use server';
/**
 * The MobiAI chat window's server actions (docs/design/92 phase C): the start, a question and a conversation, with
 * this website's session and the person's rights. Errors come back as {ok: false} with the API's type and words.
 */
import type {
  AssistantWindowAnswer,
  AssistantWindowMessage,
  AssistantWindowResult,
  AssistantWindowStart,
} from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

type Fail = { ok: false; status: number; type: string; detail: string };
function fail(error: unknown): Fail {
  if (error instanceof ApiError)
    return {
      ok: false,
      status: error.status,
      type: error.problem.type,
      detail: typeof error.problem.detail === 'string' ? error.problem.detail : '',
    };
  throw error;
}

export async function windowStart(): Promise<AssistantWindowResult<AssistantWindowStart>> {
  try {
    return {
      ok: true,
      data: await bff.api.fetch<AssistantWindowStart>('/insights/assistant/start'),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function windowAsk(
  question: string,
  conversationId: string | null,
  language: string | null,
): Promise<AssistantWindowResult<AssistantWindowAnswer>> {
  try {
    const data = await bff.api.fetch<AssistantWindowAnswer>('/insights/assistant', {
      method: 'POST',
      body: JSON.stringify({
        question: String(question).slice(0, 1000),
        conversationId:
          conversationId && /^[0-9a-f-]{36}$/.test(conversationId) ? conversationId : undefined,
        language:
          language === 'hi' || language === 'en' || language === 'hinglish' ? language : undefined,
        surface: 'teacher',
      }),
    });
    return { ok: true, data };
  } catch (error) {
    return fail(error);
  }
}

export async function windowConversation(
  id: string,
): Promise<AssistantWindowResult<{ messages: AssistantWindowMessage[] }>> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, status: 404, type: 'not-found', detail: '' };
  try {
    const data = await bff.api.fetch<{ messages: AssistantWindowMessage[] }>(
      `/insights/assistant/conversations/${id}`,
    );
    return { ok: true, data: { messages: data.messages ?? [] } };
  } catch (error) {
    return fail(error);
  }
}
