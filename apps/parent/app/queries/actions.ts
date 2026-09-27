'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 160))}`,
    );
  }
  throw error;
}

/** S10: a guardian raises a query, complaint or leave request for one child. */
export async function raiseQuery(fd: FormData) {
  let id = '';
  try {
    const r = await bff.api.fetch<{ id: string }>('/engagement/mine/queries', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        kind: str(fd, 'kind') || 'query',
        categoryCode: str(fd, 'categoryCode') || 'other',
        subject: str(fd, 'subject'),
        body: str(fd, 'body'),
        leaveFrom: str(fd, 'leaveFrom') || undefined,
        leaveTo: str(fd, 'leaveTo') || undefined,
      }),
    });
    id = r.id;
  } catch (error) {
    fail('/queries/new', error);
  }
  redirect(`/queries/${id}?ok=1`);
}

export async function replyToQuery(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/engagement/mine/queries/${id}/responses`, {
      method: 'POST',
      body: JSON.stringify({ body: str(fd, 'body') }),
    });
  } catch (error) {
    fail(`/queries/${id}`, error);
  }
  redirect(`/queries/${id}?ok=1`);
}

export async function rateQuery(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/engagement/mine/queries/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({
        rating: Number(str(fd, 'rating')),
        comment: str(fd, 'comment') || undefined,
      }),
    });
  } catch (error) {
    fail(`/queries/${id}`, error);
  }
  redirect(`/queries/${id}?ok=1`);
}

export async function giveFeedback(fd: FormData) {
  try {
    await bff.api.fetch('/engagement/feedback', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId') || undefined,
        category: str(fd, 'category'),
        rating: Number(str(fd, 'rating')),
        comment: str(fd, 'comment') || undefined,
      }),
    });
  } catch (error) {
    fail('/queries', error);
  }
  redirect('/queries?ok=feedback');
}

export async function requestProfileChange(fd: FormData) {
  const changes: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('change.') || typeof value !== 'string') continue;
    const v = value.trim();
    if (v) changes[key.slice(7)] = v;
  }
  try {
    await bff.api.fetch('/engagement/change-requests', {
      method: 'POST',
      body: JSON.stringify({
        studentId: str(fd, 'studentId'),
        entity: str(fd, 'entity'),
        entityId: str(fd, 'entityId') || undefined,
        changes,
        reason: str(fd, 'reason') || undefined,
      }),
    });
  } catch (error) {
    fail('/profile', error);
  }
  redirect('/profile?ok=1');
}

export async function setConsent(fd: FormData) {
  try {
    await bff.api.fetch('/comms/consents/mine', {
      method: 'POST',
      body: JSON.stringify({ purposeCode: str(fd, 'purposeCode'), status: str(fd, 'status') }),
    });
  } catch (error) {
    fail('/profile', error);
  }
  redirect('/profile?ok=consent');
}
