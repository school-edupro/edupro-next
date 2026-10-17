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
 * A guardian answers a consent form for one child (docs/design/28-consent-forms.md): the answers come
 * as JSON from the form, each file question's files are uploaded first and named by their ids.
 */
export async function respondConsent(fd: FormData) {
  const formId = str(fd, 'formId');
  const studentId = str(fd, 'studentId');
  const back = `/consents/${formId}?student=${studentId}`;
  let out:
    | { id: string; number: string; success: string | null; fee: number; waiting: boolean }
    | undefined;
  try {
    const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
    for (const key of new Set(
      [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
    )) {
      if (fd.get(`skip__${key}`)) continue;
      const ids = await uploadFiles(fd, `file__${key}`);
      if (ids.length) answers[key] = ids;
    }
    out = await bff.api.fetch<{
      id: string;
      number: string;
      success: string | null;
      fee: number;
      waiting: boolean;
    }>(`/engagement/mine/consent-forms/${formId}/responses`, {
      method: 'POST',
      body: JSON.stringify({
        studentId: studentId || undefined,
        answers,
        signedName: str(fd, 'signedName') || undefined,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  const q = new URLSearchParams({ done: out!.number });
  if (out!.success) q.set('msg', out!.success.slice(0, 300));
  if (out!.waiting) q.set('waiting', '1');
  if (out!.fee > 0) q.set('fee', String(out!.fee));
  redirect(`/consents?${q.toString()}`);
}

/**
 * A guardian changes an answer (until the form's edit date, while not yet decided): a file question with
 * no new file and a signature not drawn again keep what was sent before ("keep").
 */
export async function editConsent(fd: FormData) {
  const formId = str(fd, 'formId');
  const studentId = str(fd, 'studentId');
  const rid = str(fd, 'responseId');
  const back = `/consents/${formId}?student=${studentId}&response=${rid}`;
  let out: { number: string; fee: number } | undefined;
  try {
    const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
    for (const key of new Set(
      [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
    )) {
      if (fd.get(`skip__${key}`)) continue;
      const ids = await uploadFiles(fd, `file__${key}`);
      if (ids.length) answers[key] = ids;
    }
    out = await bff.api.fetch<{ number: string; fee: number }>(
      `/engagement/mine/consent-forms/responses/${rid}`,
      {
        method: 'PUT',
        body: JSON.stringify({ answers, signedName: str(fd, 'signedName') || undefined }),
      },
    );
  } catch (error) {
    fail(back, error);
  }
  redirect(`/consents?changed=${encodeURIComponent(out!.number)}`);
}
