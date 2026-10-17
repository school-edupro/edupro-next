'use server';
/** Consent forms (docs/design/28-consent-forms.md): build, publish, close, notify, fill on behalf. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/engagement/consent-forms';
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

/** Creates or saves a form from the builder's JSON. */
export async function saveConsentForm(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = id ? `${BASE}/${id}/edit` : `${BASE}/new`;
  let saved: { id: string };
  try {
    saved = await apiFetch<{ id: string }>(id ? `${BASE}/${id}` : BASE, {
      method: id ? 'PUT' : 'POST',
      body: str(fd, 'form'),
    });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${saved.id}?ok=saved`);
}

/** Publish (with the app notification), close, reopen or archive. */
export async function setConsentStatus(fd: FormData) {
  const id = str(fd, 'id');
  let told = 0;
  try {
    const r = await apiFetch<{ told?: number }>(`${BASE}/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: str(fd, 'status'), push: str(fd, 'push') !== 'no' }),
    });
    told = r.told ?? 0;
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=${str(fd, 'status')}&told=${told}`);
}

export async function notifyConsentPending(fd: FormData) {
  const id = str(fd, 'id');
  let told = 0;
  try {
    told = (
      await apiFetch<{ told: number }>(`${BASE}/${id}/notify`, { method: 'POST', body: '{}' })
    ).told;
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  redirect(`${BASE}/${id}?ok=notified&told=${told}`);
}

export async function copyConsentForm(fd: FormData) {
  const id = str(fd, 'id');
  let copy: { id: string };
  try {
    copy = await apiFetch<{ id: string }>(`${BASE}/${id}/copy`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${copy.id}/edit?ok=copied`);
}

export async function deleteConsentForm(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`${BASE}/${id}`, { method: 'DELETE' });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=deleted`);
}

/** The office fills the form for a pupil or a staff member (a paper form typed in). */
export async function fillConsentForOffice(fd: FormData) {
  const id = str(fd, 'formId');
  const who = str(fd, 'who');
  const returnTo = `${BASE}/${id}/fill?who=${encodeURIComponent(who)}`;
  let done: { id: string; number: string };
  try {
    const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
    for (const key of new Set(
      [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
    )) {
      if (fd.get(`skip__${key}`)) continue;
      const ids = await uploadAll(fd, `file__${key}`);
      if (ids.length) answers[key] = ids;
    }
    const [kind, personId] = who.split(':');
    done = await apiFetch<{ id: string; number: string }>(`${BASE}/${id}/responses`, {
      method: 'POST',
      body: JSON.stringify({
        ...(kind === 'student' ? { studentId: personId } : { employeeId: personId }),
        answers,
        signedName: str(fd, 'signedName') || undefined,
      }),
    });
  } catch (error) {
    back(returnTo, error);
  }
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}/responses/${done.id}?ok=filled`);
}
