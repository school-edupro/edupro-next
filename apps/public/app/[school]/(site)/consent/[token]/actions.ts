'use server';
import { redirect } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import { consentFetch, SCHOOL_RE, TOKEN_RE } from '@/lib/consent';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function fail(back: string, error: unknown): never {
  if (error instanceof PublicApiError) {
    const detail = (error.problem.detail ?? error.problem.type).slice(0, 200);
    redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(detail)}`);
  }
  throw error;
}

/** Uploads the files of one question through the link's own upload slots; returns their ids. */
async function uploadAll(school: string, token: string, fd: FormData, key: string) {
  const files = fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5)
    throw new PublicApiError(400, { type: 'validation-failed', detail: 'Attach up to 5 files.' });
  const ids: string[] = [];
  for (const file of files) {
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
      throw new PublicApiError(400, {
        type: 'validation-failed',
        detail: `${file.name}: attach a PDF or a photo (PNG, JPEG, WebP).`,
      });
    if (file.size > 5 * 1024 * 1024)
      throw new PublicApiError(400, {
        type: 'validation-failed',
        detail: `${file.name}: larger than 5 MB.`,
      });
    const slot = await consentFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>(school, token, '/uploads', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    const target = slot.upload.url.startsWith('http')
      ? slot.upload.url
      : `${API_BASE}${slot.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(slot.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: slot.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok)
      throw new PublicApiError(put.status, {
        type: 'file.upload_failed',
        detail: `${file.name} did not upload.`,
      });
    ids.push(slot.file.id);
  }
  return ids;
}

async function answersOf(school: string, token: string, fd: FormData) {
  const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
  for (const key of new Set(
    [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
  )) {
    if (fd.get(`skip__${key}`)) continue;
    const ids = await uploadAll(school, token, fd, `file__${key}`);
    if (ids.length) answers[key] = ids;
  }
  return answers;
}

/** Answers the form on its public link (a family for its pupil, an outsider for themself). */
export async function respondOnLink(fd: FormData) {
  const school = str(fd, 'school');
  const token = str(fd, 'token');
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token)) redirect('/');
  const back = `/${school}/consent/${token}`;
  let out: { number: string; success: string | null; fee: number; waiting: boolean } | undefined;
  try {
    out = await consentFetch(school, token, '/responses', {
      method: 'POST',
      body: JSON.stringify({
        answers: await answersOf(school, token, fd),
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
  redirect(`${back}?${q.toString()}`);
}

/** Changes an answer on the public link (until the edit date, before it is decided). */
export async function editOnLink(fd: FormData) {
  const school = str(fd, 'school');
  const token = str(fd, 'token');
  const rid = str(fd, 'responseId');
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token) || !/^\d+$/.test(rid)) redirect('/');
  const back = `/${school}/consent/${token}`;
  let out: { number: string } | undefined;
  try {
    out = await consentFetch(school, token, `/responses/${rid}`, {
      method: 'PUT',
      body: JSON.stringify({
        answers: await answersOf(school, token, fd),
        signedName: str(fd, 'signedName') || undefined,
      }),
    });
  } catch (error) {
    fail(`${back}?edit=${rid}`, error);
  }
  redirect(`${back}?changed=${encodeURIComponent(out!.number)}`);
}
