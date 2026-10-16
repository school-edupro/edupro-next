'use server';
/** Hostel withdrawal (docs/design/27-hostel-withdrawal.md): start, approve or reject, complete, cancel, settings. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/hostel/withdrawals';
const join = (path: string, q: string) => `${path}${path.includes('?') ? '&' : '?'}${q}`;

function back(path: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ path?: string; message?: string }> | undefined;
    const detail = Array.isArray(errs)
      ? errs.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`).join('; ')
      : (error.problem.detail ?? error.problem.type);
    redirect(
      join(
        path,
        `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(detail).slice(0, 300))}`,
      ),
    );
  }
  throw error;
}

/** Uploads the files of a form field (PDF or image, up to 5 MB, five at most); returns their ids. */
async function uploadAll(fd: FormData, key: string): Promise<string[]> {
  const files = fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5)
    throw new ApiError(400, { type: 'validation-failed', detail: 'Attach up to 5 files' });
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
        detail: `${file.name} did not upload`,
      });
    ids.push(reg.file.id);
  }
  return ids;
}

export async function startHostelWithdrawal(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const from = `${BASE}/new?student=${studentId}`;
  let id = '';
  try {
    const files = await uploadAll(fd, 'documents');
    const out = await apiFetch<{ id: string }>(`/hostel/students/${studentId}/withdrawal`, {
      method: 'POST',
      body: JSON.stringify({
        requestedOn: str(fd, 'requestedOn') || undefined,
        leavingOn: str(fd, 'leavingOn'),
        reason: str(fd, 'reason'),
        remarks: str(fd, 'remarks') || undefined,
        documents: files.map((fileId) => ({ fileId })),
        damageCharge: Number(str(fd, 'damageCharge') || '0'),
        messCharge: Number(str(fd, 'messCharge') || '0'),
        chargeRemarks: str(fd, 'chargeRemarks') || undefined,
      }),
    });
    id = out.id;
  } catch (error) {
    back(from, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=started`);
}

/** The approver of the current level approves or rejects; the last level picks carry-forward or refund. */
export async function decideHostelWithdrawal(fd: FormData) {
  const id = str(fd, 'id');
  const to = `${BASE}/${id}`;
  const outcome = str(fd, 'outcome') === 'rejected' ? 'rejected' : 'approved';
  const choice = str(fd, 'feeChoice');
  try {
    await apiFetch(`/hostel/withdrawals/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({
        outcome,
        note: str(fd, 'note') || undefined,
        ...(choice === 'carry' || choice === 'refund' ? { feeChoice: choice } : {}),
      }),
    });
  } catch (error) {
    back(to, error);
  }
  revalidatePath(BASE);
  redirect(`${to}?ok=${outcome}`);
}
/** One action per button: a button's own name/value does not reach a server action. */
export async function approveHostelWithdrawal(fd: FormData) {
  fd.set('outcome', 'approved');
  return decideHostelWithdrawal(fd);
}
export async function rejectHostelWithdrawal(fd: FormData) {
  fd.set('outcome', 'rejected');
  return decideHostelWithdrawal(fd);
}

export async function completeHostelWithdrawal(fd: FormData) {
  const id = str(fd, 'id');
  const to = `${BASE}/${id}`;
  try {
    const choice = str(fd, 'feeChoice');
    await apiFetch(`/hostel/withdrawals/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify(choice === 'carry' || choice === 'refund' ? { feeChoice: choice } : {}),
    });
  } catch (error) {
    back(to, error);
  }
  revalidatePath(BASE);
  redirect(`${to}?ok=completed`);
}

export async function cancelHostelWithdrawal(fd: FormData) {
  const id = str(fd, 'id');
  const to = `${BASE}/${id}`;
  try {
    await apiFetch(`/hostel/withdrawals/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (error) {
    back(to, error);
  }
  revalidatePath(BASE);
  redirect(`${to}?ok=cancelled`);
}

export async function saveHostelNotice(fd: FormData) {
  const to = `${BASE}/settings`;
  try {
    await apiFetch('/hostel/withdrawal-settings/notice', {
      method: 'PUT',
      body: JSON.stringify({
        noticeDays: Number(str(fd, 'noticeDays') || '0'),
        noticeCharge: fd.get('noticeCharge') === 'on',
      }),
    });
  } catch (error) {
    back(to, error);
  }
  revalidatePath(to);
  redirect(`${to}?ok=saved`);
}
