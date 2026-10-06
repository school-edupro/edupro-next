'use server';
/** File movement: raising, correcting, deciding and withdrawing a file. Attachments are uploaded first. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
const BASE = '/workflow/files';

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

/** Uploads the new attachments of the form; returns their ids. */
async function uploadAll(fd: FormData, room: number): Promise<string[]> {
  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > room)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: 'A file can carry at most 4 attachments',
    });
  const ids: string[] = [];
  for (const file of files) {
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: `${file.name}: attach a PDF or an image (PNG, JPEG, WebP)`,
      });
    if (file.size > 5 * 1024 * 1024)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: `${file.name}: larger than 5 MB`,
      });
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        sizeBytes: file.size,
        classification: 'internal',
      }),
    });
    const target = reg.upload.url.startsWith('http') ? reg.upload.url : `${API}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok)
      throw new ApiError(put.status, {
        type: 'file.upload_failed',
        detail: `${file.name} did not upload`,
      });
    ids.push(reg.file.id);
  }
  return ids;
}

/** A new file, or (with `id`) a file sent back that is corrected and submitted again. */
export async function submitFile(fd: FormData) {
  const id = str(fd, 'id');
  const here = id ? `${BASE}/${id}?edit=1` : `${BASE}/new`;
  let saved = id;
  try {
    const kept = fd.getAll('keep').map(String).filter(Boolean);
    const fileIds = [...kept, ...(await uploadAll(fd, 4 - kept.length))];
    const body = JSON.stringify({
      subject: str(fd, 'subject'),
      bodyHtml: str(fd, 'bodyHtml'),
      fileIds,
      approverIds: fd.getAll('approverIds').map(String).filter(Boolean),
    });
    const r = await apiFetch<{ id: string }>(id ? `/file-movement/${id}` : '/file-movement', {
      method: id ? 'PUT' : 'POST',
      body,
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
  try {
    await apiFetch(`/file-movement/${id}/decide`, {
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
  try {
    await apiFetch(`/file-movement/${id}/withdraw`, { method: 'POST' });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=withdrawn`);
}
