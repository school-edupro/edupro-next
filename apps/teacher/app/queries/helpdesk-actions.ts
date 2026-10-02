'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { uploadFiles } from '@/lib/upload';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      Array.isArray(errs) && errs.length
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : typeof error.problem.detail === 'string'
          ? error.problem.detail
          : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
}

/** A teacher raises a staff query or a ticket to the ERP provider, with attachments. */
export async function raise(fd: FormData) {
  const desk = str(fd, 'desk') === 'provider' ? 'provider' : 'staff';
  let id = '';
  try {
    const fileIds = await uploadFiles(fd);
    id = (
      await bff.api.fetch<{ id: string }>('/helpdesk/tickets', {
        method: 'POST',
        body: JSON.stringify({
          desk,
          categoryCode: str(fd, 'categoryCode'),
          subject: str(fd, 'subject'),
          body: str(fd, 'body'),
          priority: str(fd, 'priority') || 'normal',
          module: str(fd, 'module') || undefined,
          fileIds,
        }),
      })
    ).id;
  } catch (error) {
    fail(`/queries/new?desk=${desk}`, error);
  }
  redirect(`/queries/t/${id}?ok=1`);
}

async function act(
  fd: FormData,
  what: string,
  body: (fileIds: string[]) => Record<string, unknown>,
) {
  const id = str(fd, 'id');
  try {
    const fileIds = await uploadFiles(fd);
    await bff.api.fetch(`/helpdesk/tickets/${id}/${what}`, {
      method: 'POST',
      body: JSON.stringify(body(fileIds)),
    });
  } catch (error) {
    fail(`/queries/t/${id}`, error);
  }
  redirect(`/queries/t/${id}?ok=1`);
}

export async function reply(fd: FormData) {
  await act(fd, 'replies', (fileIds) => ({
    body: str(fd, 'body'),
    fileIds,
    isInternal: fd.get('isInternal') === 'on',
  }));
}

export async function handOver(fd: FormData) {
  const to = str(fd, 'to');
  await act(fd, 'assign', () => ({
    ...(to.startsWith('role:') ? { roleCode: to.slice(5) } : { userId: to.replace(/^user:/, '') }),
    note: str(fd, 'note') || undefined,
  }));
}

export async function close(fd: FormData) {
  await act(fd, 'close', (fileIds) => ({ resolution: str(fd, 'resolution'), fileIds }));
}

export async function reopen(fd: FormData) {
  await act(fd, 'reopen', (fileIds) => ({ reason: str(fd, 'reason'), fileIds }));
}

export async function rate(fd: FormData) {
  await act(fd, 'rate', () => ({
    rating: Number(str(fd, 'rating')),
    comment: str(fd, 'comment') || undefined,
  }));
}
