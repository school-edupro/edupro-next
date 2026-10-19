'use server';
/**
 * My profile in the admin app: send changes with their proof documents, withdraw a request, get my PDF.
 * Mirrors apps/teacher/app/(app)/profile/actions.ts over the admin session (ADR-007).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/me/profile';

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const list = error.problem.errors as Array<{ path?: string; message?: string }> | undefined;
    const detail = Array.isArray(list)
      ? list
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : typeof error.problem.detail === 'string'
        ? error.problem.detail
        : '';
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
}

function done(detail: string): never {
  revalidatePath(BASE);
  redirect(`${BASE}?ok=1&detail=${encodeURIComponent(detail)}&r=${Date.now().toString(36)}`);
}

/** One proof document, uploaded as mine (the API checks it was my upload). */
async function upload(file: File): Promise<string> {
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: `${file.name}: attach a PDF or a photo.`,
    });
  if (file.size > 5 * 1024 * 1024)
    throw new ApiError(400, {
      type: 'validation-failed',
      detail: `${file.name} is larger than 5 MB.`,
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
      classification: 'personal',
    }),
  });
  const target = reg.upload.url.startsWith('http') ? reg.upload.url : `${API}${reg.upload.url}`;
  // Headers merges case-insensitively: a doubled Content-Type is refused with 415
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
      detail: 'The document could not be uploaded.',
    });
  return reg.file.id;
}

/** The fields of one section that differ from what is on file (the form carries both), with proofs. */
export async function sendMyChanges(fd: FormData) {
  const section = str(fd, 'section');
  const back = `${BASE}/edit?section=${encodeURIComponent(section)}`;
  const changes: Record<string, string | null> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('v.')) continue;
    const key = k.slice(2);
    const now = String(v).trim();
    const was = str(fd, `o.${key}`);
    if (now !== was) changes[key] = now === '' ? null : now;
  }
  if (!Object.keys(changes).length)
    redirect(`${back}&error=no-change&detail=${encodeURIComponent('Nothing was changed.')}`);
  let out: { applied: string[]; pending: string[] } | undefined;
  try {
    const proofs: Array<{ typeId: string; fileId: string }> = [];
    for (const [k, v] of fd.entries())
      if (k.startsWith('proof.') && v instanceof File && v.size > 0)
        proofs.push({ typeId: k.slice(6), fileId: await upload(v) });
    out = await apiFetch('/me/employee-profile/changes', {
      method: 'POST',
      body: JSON.stringify({ changes, reason: str(fd, 'reason') || null, proofs }),
    });
  } catch (error) {
    fail(back, error);
  }
  const msg = [
    out!.applied.length ? `${String(out!.applied.length)} saved` : '',
    out!.pending.length ? `${String(out!.pending.length)} sent for approval` : '',
  ]
    .filter(Boolean)
    .join(', ');
  done(`${msg}.`);
}

export async function withdrawMyRequest(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/me/employee-change-requests/${id}/cancel`, { method: 'POST' });
  } catch (error) {
    fail(BASE, error);
  }
  done('Request withdrawn.');
}

/** Queues my own profile PDF (ID numbers in full) and shows it on the page when the workers are done. */
export async function myProfilePdf() {
  let id = '';
  try {
    id = (await apiFetch<{ id: string }>('/me/employee-profile/print', { method: 'POST' })).id;
  } catch (error) {
    fail(BASE, error);
  }
  redirect(`${BASE}?export=${id}`);
}

/** Reads the row fields of a list form (`r.<key>`, `bool`/`num` markers) into one row change. */
function rowDataOf(fd: FormData): Record<string, string | number | boolean | null> {
  const data: Record<string, string | number | boolean | null> = {};
  const bools = new Set(fd.getAll('bool').map(String));
  const nums = new Set(fd.getAll('num').map(String));
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('r.') || v instanceof File) continue;
    const key = k.slice(2);
    const val = String(v).trim();
    if (bools.has(key)) continue;
    if (val === '') continue;
    data[key] = nums.has(key) ? Number(val) : val;
  }
  for (const key of bools) data[key] = fd.get(`r.${key}`) !== null;
  return data;
}

/** Add or change one row of a list (education, languages, experience, documents), with its proof. */
export async function sendMyRowChange(fd: FormData) {
  const kind = str(fd, 'kind');
  const op = str(fd, 'op') === 'edit' ? 'edit' : 'add';
  const rowId = str(fd, 'rowId') || undefined;
  const back = `${BASE}/edit?section=${encodeURIComponent(kind)}${rowId ? `&row=${rowId}` : '&add=1'}`;
  const data = rowDataOf(fd);
  let out: { applied: string[]; pending: string[] } | undefined;
  try {
    const proofs: Array<{ typeId: string; fileId: string }> = [];
    for (const [k, v] of fd.entries())
      if (k.startsWith('proof.') && v instanceof File && v.size > 0)
        proofs.push({ typeId: k.slice(6), fileId: await upload(v) });
    if (kind === 'documents') {
      const f = fd.get('doc.file');
      if (!(f instanceof File) || !f.size)
        throw new ApiError(400, { type: 'validation-failed', detail: 'Attach the document file.' });
      data.fileId = await upload(f);
    }
    out = await apiFetch('/me/employee-profile/changes', {
      method: 'POST',
      body: JSON.stringify({
        rows: [{ kind, op, rowId, data }],
        reason: str(fd, 'reason') || null,
        proofs,
      }),
    });
  } catch (error) {
    fail(back, error);
  }
  done(out!.applied.length ? 'Saved.' : 'Sent for approval.');
}

/** Ask to remove one row (or a document); it goes the way the list's changes go. */
export async function removeMyRow(fd: FormData) {
  const kind = str(fd, 'kind');
  const rowId = str(fd, 'rowId');
  let out: { applied: string[]; pending: string[] } | undefined;
  try {
    out = await apiFetch('/me/employee-profile/changes', {
      method: 'POST',
      body: JSON.stringify({
        rows: [{ kind, op: 'remove', rowId }],
        reason: str(fd, 'reason') || null,
      }),
    });
  } catch (error) {
    fail(BASE, error);
  }
  done(out!.applied.length ? 'Removed.' : 'Removal sent for approval.');
}
