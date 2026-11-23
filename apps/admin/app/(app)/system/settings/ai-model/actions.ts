'use server';
/**
 * The AI model (LLM) for all schools (docs/design/101): save its settings, test it. Only holders of the right "AI
 * model for all schools" may; the API checks, and never returns the token.
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api';

export interface AiModelSettings {
  url: string;
  tokenLast4: string;
  replyField: string | null;
  timeoutSeconds: number;
  on: boolean;
  /** docs/design/102: who runs the model (named in families' consent) */
  operator: string | null;
  updatedBy: string | null;
  updatedAt: string;
  lastTest: { at: string; ok: boolean | null; note: string | null } | null;
}

export interface AiModelView {
  canManage: boolean;
  configured: boolean;
  on: boolean;
  settings: AiModelSettings | null;
}

export type SaveState = { ok: boolean; message: string } | null;

export interface TestResult {
  ok: boolean;
  status: number | null;
  ms: number;
  reply: string | null;
  field: string | null;
  problem: string | null;
  raw: string;
}

/** the API's words for a refusal: its field messages, else its detail */
function words(e: ApiError): string {
  if (e.status === 403)
    return 'Only holders of the right “AI model for all schools” may change it.';
  const errs = e.problem.errors as Array<{ message?: string }> | undefined;
  const list = Array.isArray(errs) ? errs.map((x) => x.message).filter(Boolean) : [];
  return list.length ? list.join(' ') : (e.problem.detail ?? e.problem.title ?? 'Not saved.');
}

export async function saveAiModel(_prev: SaveState, fd: FormData): Promise<SaveState> {
  const body = {
    url: String(fd.get('url') ?? '').trim(),
    token: String(fd.get('token') ?? ''),
    replyField: String(fd.get('replyField') ?? '').trim(),
    timeoutSeconds: Number(fd.get('timeoutSeconds') ?? 30),
    on: fd.get('on') === 'on',
    operator: String(fd.get('operator') ?? '').trim(),
  };
  try {
    await apiFetch('/platform/ai-model', { method: 'PUT', body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: `${words(e)} Nothing was saved.` };
    throw e;
  }
  revalidatePath('/system/settings/ai-model');
  revalidatePath('/system/settings');
  return {
    ok: true,
    message: body.on
      ? 'Saved. The AI model is on: schools that switched it on use it now.'
      : 'Saved. Test it below, then switch it on.',
  };
}

export async function testAiModel(
  prompt: string,
): Promise<{ result: TestResult } | { error: string }> {
  try {
    const result = await apiFetch<TestResult>('/platform/ai-model/test', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    revalidatePath('/system/settings/ai-model');
    return { result };
  } catch (e) {
    if (e instanceof ApiError) return { error: words(e) };
    throw e;
  }
}
