'use server';
/**
 * File movement on the staff website (as the admin's /workflow/files): raising, correcting, deciding and withdrawing
 * a file. Attachments are uploaded first (PDF or photo, 5 MB each, at most four on a file).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from './bff';
import { uploadFiles } from './upload';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
const BASE = '/files';

function back(path: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as
      Array<{ message?: string }> | Record<string, string> | undefined;
    const detail = Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : errs && typeof errs === 'object'
        ? Object.values(errs).join('; ')
        : (error.problem.detail ?? '');
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(detail).slice(0, 300))}`,
    );
  }
  throw error;
}

/** A new file, or (with `id`) a file sent back that is corrected and submitted again. */
export async function submitFile(fd: FormData) {
  const id = str(fd, 'id');
  if (id && !okId(id)) redirect(BASE);
  const here = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  let saved = id;
  try {
    const kept = fd.getAll('keep').map(String).filter(okId);
    const added = await uploadFiles(fd, 'files');
    if (kept.length + added.length > 4)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: 'A file can carry at most 4 attachments',
      });
    const r = await bff.api.fetch<{ id: string }>(id ? `/file-movement/${id}` : '/file-movement', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        subject: str(fd, 'subject'),
        bodyHtml: str(fd, 'bodyHtml'),
        fileIds: [...kept, ...added],
        approverIds: fd.getAll('approverIds').map(String).filter(okId),
      }),
    });
    saved = r.id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${saved}?ok=${id ? 'resubmitted' : 'submitted'}`);
}

async function decide(fd: FormData, outcome: 'approved' | 'returned' | 'rejected') {
  const id = str(fd, 'id');
  if (!okId(id)) redirect(BASE);
  try {
    await bff.api.fetch(`/file-movement/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, remark: str(fd, 'remark') || undefined }),
    });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=${outcome}`);
}
// each button has its own action, so the decision never depends on the button's value reaching the server
export async function approveFile(fd: FormData) {
  return decide(fd, 'approved');
}
export async function returnFile(fd: FormData) {
  return decide(fd, 'returned');
}
export async function rejectFile(fd: FormData) {
  return decide(fd, 'rejected');
}

export async function withdrawFile(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect(BASE);
  try {
    await bff.api.fetch(`/file-movement/${id}/withdraw`, { method: 'POST' });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=withdrawn`);
}
