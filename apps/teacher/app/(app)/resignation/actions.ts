'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { uploadFiles } from '@/lib/upload';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function failed(error: unknown, back: string): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as
      Record<string, string> | Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : errs && Object.values(errs).join('; ')) ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '');
    redirect(
      `${back}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/** My resignation, with the letter if attached; it goes for approval. */
export async function applyResignation(fd: FormData) {
  try {
    const [letter] = await uploadFiles(fd, 'letter');
    await bff.api.fetch('/me/exits', {
      method: 'POST',
      body: JSON.stringify({
        exitType: str(fd, 'exitType'),
        reason: str(fd, 'reason'),
        ...(str(fd, 'proposedLastDay') ? { proposedLastDay: str(fd, 'proposedLastDay') } : {}),
        ...(letter ? { letterFileId: letter } : {}),
      }),
    });
  } catch (error) {
    failed(error, '/resignation');
  }
  redirect('/resignation?ok=sent');
}

export async function withdrawResignation(fd: FormData) {
  try {
    await bff.api.fetch(`/people/exits/${str(fd, 'id')}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Withdrawn by the employee' }),
    });
  } catch (error) {
    failed(error, '/resignation');
  }
  redirect('/resignation?ok=withdrawn');
}

export async function resubmitResignation(fd: FormData) {
  try {
    const [letter] = await uploadFiles(fd, 'letter');
    await bff.api.fetch(`/people/exits/${str(fd, 'id')}/resubmit`, {
      method: 'POST',
      body: JSON.stringify({
        reason: str(fd, 'reason'),
        ...(str(fd, 'proposedLastDay') ? { proposedLastDay: str(fd, 'proposedLastDay') } : {}),
        ...(letter ? { letterFileId: letter } : {}),
      }),
    });
  } catch (error) {
    failed(error, '/resignation');
  }
  redirect('/resignation?ok=resent');
}

/** An approver's decision on an exit waiting with them. */
async function decide(fd: FormData, action: 'approve' | 'send-back' | 'reject') {
  const lastDay = str(fd, 'acceptedLastDay');
  try {
    await bff.api.fetch(`/people/exits/${str(fd, 'id')}/${action}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(str(fd, 'note') ? { note: str(fd, 'note') } : {}),
        ...(action === 'approve' && lastDay && lastDay !== str(fd, 'proposedLastDay')
          ? { acceptedLastDay: lastDay }
          : {}),
        ...(action === 'approve' && fd.get('waiveNotice') === 'on' ? { waiveNotice: true } : {}),
      }),
    });
  } catch (error) {
    failed(error, '/exit-approvals');
  }
  redirect(`/exit-approvals?ok=${action}`);
}
export async function approveExit(fd: FormData) {
  return decide(fd, 'approve');
}
export async function sendBackExit(fd: FormData) {
  return decide(fd, 'send-back');
}
export async function rejectExit(fd: FormData) {
  return decide(fd, 'reject');
}
