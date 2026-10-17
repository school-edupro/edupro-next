'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { uploadFiles } from '@/lib/upload';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    if (error.status === 401) redirect('/login?error=session-expired');
    const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/**
 * A staff member answers a consent form for themself (docs/design/28-consent-forms.md): the answers come
 * as JSON from the form, each file question's files are uploaded first and named by their ids.
 */
export async function respondConsent(fd: FormData) {
  const formId = str(fd, 'formId');
  const back = `/consents/${formId}`;
  let out: { id: string; number: string; success: string | null } | undefined;
  try {
    const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
    for (const key of new Set(
      [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
    )) {
      if (fd.get(`skip__${key}`)) continue;
      const ids = await uploadFiles(fd, `file__${key}`);
      if (ids.length) answers[key] = ids;
    }
    out = await bff.api.fetch<{ id: string; number: string; success: string | null }>(
      `/engagement/mine/consent-forms/${formId}/responses`,
      {
        method: 'POST',
        body: JSON.stringify({
          answers,
          signedName: str(fd, 'signedName') || undefined,
        }),
      },
    );
  } catch (error) {
    fail(back, error);
  }
  const q = new URLSearchParams({ done: out!.number });
  if (out!.success) q.set('msg', out!.success.slice(0, 300));
  redirect(`/consents?${q.toString()}`);
}
