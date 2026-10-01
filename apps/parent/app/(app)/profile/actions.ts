'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
const idOk = (id: string) => /^\d{1,18}$/.test(id);

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const fieldErrors = error.problem.errors as Record<string, string> | undefined;
    const detail =
      fieldErrors && Object.keys(fieldErrors).length
        ? Object.values(fieldErrors).join('; ')
        : typeof error.problem.detail === 'string'
          ? error.problem.detail
          : '';
    const url = new URL(back, 'http://portal.local');
    url.searchParams.set('error', error.problem.type);
    url.searchParams.set('detail', detail.slice(0, 300));
    redirect(`${url.pathname}${url.search}`);
  }
  throw error;
}

/** Uploads one proof document and returns its file id (the API checks it was this user's upload). */
async function upload(file: File): Promise<string> {
  const reg = await bff.api.fetch<{
    file: { id: string };
    upload: { url: string; method: string; headers?: Record<string, string> };
  }>('/platform/files', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name.slice(0, 200),
      contentType: file.type,
      sizeBytes: file.size,
      classification: 'personal',
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
      detail: 'The document could not be uploaded. Try a smaller PDF or photo.',
    });
  return reg.file.id;
}

/**
 * Sends the fields a parent changed on one section: only values that differ from what was on file
 * (the form carries both), with the proof documents the school asks for.
 */
export async function submitProfileChanges(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const section = str(fd, 'section');
  const back = `/profile/edit?child=${studentId}&section=${encodeURIComponent(section)}`;
  if (!idOk(studentId)) redirect('/profile');
  const changes: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('v.') || typeof value !== 'string') continue;
    const k = key.slice(2);
    const before = String(fd.get(`o.${k}`) ?? '');
    if (value.trim() !== before.trim()) changes[k] = value.trim();
  }
  if (!Object.keys(changes).length)
    redirect(`${back}&error=nothing&detail=${encodeURIComponent('Nothing was changed.')}`);
  let result: { applied: string[]; pending: string[] } = { applied: [], pending: [] };
  try {
    const proofs: Array<{ kind: string; fileId: string }> = [];
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith('proof.') || !(value instanceof File) || value.size === 0) continue;
      proofs.push({ kind: key.slice(6), fileId: await upload(value) });
    }
    result = await bff.api.fetch(`/engagement/mine/profile/${studentId}/changes`, {
      method: 'POST',
      body: JSON.stringify({ changes, reason: str(fd, 'reason') || undefined, proofs }),
    });
  } catch (error) {
    fail(back, error);
  }
  const ok = result.pending.length ? (result.applied.length ? 'both' : 'sent') : 'saved';
  redirect(`/profile?child=${studentId}&ok=${ok}`);
}

/** Sends a new student, father or mother photo; it waits for approval unless the school saves it at once. */
export async function submitProfilePhoto(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const key = str(fd, 'key');
  if (!idOk(studentId)) redirect('/profile');
  const back = `/profile?child=${studentId}`;
  const file = fd.get('file');
  if (
    !/^photo_(student|father|mother|guardian)$/.test(key) ||
    !(file instanceof File) ||
    file.size === 0
  )
    redirect(`${back}&error=photo&detail=${encodeURIComponent('Choose a photo to send.')}`);
  if (!/^image\/(png|jpeg|webp)$/.test(file.type))
    redirect(`${back}&error=photo&detail=${encodeURIComponent('Send a JPG, PNG or WebP photo.')}`);
  if (file.size > 5 * 1024 * 1024)
    redirect(
      `${back}&error=photo&detail=${encodeURIComponent('The photo must be 5 MB or smaller.')}`,
    );
  let result: { applied: string[]; pending: string[] } = { applied: [], pending: [] };
  try {
    const fileId = await upload(file);
    result = await bff.api.fetch(`/engagement/mine/profile/${studentId}/changes`, {
      method: 'POST',
      body: JSON.stringify({ changes: { [key]: fileId }, proofs: [] }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=${result.pending.length ? 'photo_sent' : 'photo_saved'}`);
}

export async function cancelProfileRequest(fd: FormData) {
  const id = str(fd, 'id');
  const child = str(fd, 'child');
  try {
    if (idOk(id))
      await bff.api.fetch(`/engagement/mine/change-requests/${id}/cancel`, { method: 'POST' });
  } catch (error) {
    fail(`/profile?child=${child}`, error);
  }
  redirect(`/profile?child=${child}&ok=withdrawn#requests`);
}

export async function downloadProfilePdf(fd: FormData) {
  const child = str(fd, 'child');
  let id = '';
  try {
    if (!idOk(child)) redirect('/profile');
    id = (
      await bff.api.fetch<{ id: string }>(`/engagement/mine/profile/${child}/print`, {
        method: 'POST',
      })
    ).id;
  } catch (error) {
    fail(`/profile?child=${child}`, error);
  }
  redirect(`/profile?child=${child}&export=${id}`);
}
