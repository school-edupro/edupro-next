'use server';
import { redirect } from 'next/navigation';
import { API, PublicApiError } from '@/lib/api';
import { careersFetch } from '@/lib/careers';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

/** Back to the form with what the API said (the list of answers refused, or the problem). */
function back(fd: FormData, error: unknown, anchor = ''): never {
  const school = str(fd, 'school');
  const apply = str(fd, 'apply');
  const base = `/${school}/careers/form${okId(apply) ? `?apply=${apply}&` : '?'}`;
  if (error instanceof PublicApiError) {
    const list = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail = list?.length
      ? list.map((x) => x.message).join('; ')
      : String(error.problem.detail ?? error.problem.type);
    redirect(`${base}error=1&detail=${encodeURIComponent(detail.slice(0, 600))}${anchor}`);
  }
  throw error;
}
function done(fd: FormData, detail: string, anchor = ''): never {
  const school = str(fd, 'school');
  const apply = str(fd, 'apply');
  redirect(
    `/${school}/careers/form${okId(apply) ? `?apply=${apply}&` : '?'}ok=1&detail=${encodeURIComponent(detail)}${anchor}`,
  );
}

/** The whole form: answers (v.<key>), rows (r.<kind>.<i>.<column>), interests (act). */
export async function saveCareerForm(fd: FormData) {
  const values: Record<string, string | null> = {};
  const rows: Record<string, Array<Record<string, string>>> = {};
  for (const [k, raw] of fd.entries()) {
    if (typeof raw !== 'string') continue;
    if (k.startsWith('v.')) values[k.slice(2)] = raw.trim() === '' ? null : raw.trim();
    const m = /^r\.([a-z]+)\.(\d+)\.([a-zA-Z]+)$/.exec(k);
    if (m) {
      const list = (rows[m[1]!] ??= []);
      const i = Number(m[2]);
      (list[i] ??= {})[m[3]!] = raw.trim();
    }
  }
  for (const k of fd.getAll('rowKinds').map(String)) rows[k] ??= [];
  let refused: string[] = [];
  try {
    refused =
      (
        await careersFetch<{ refused?: string[] }>('/me/profile', {
          method: 'PUT',
          body: JSON.stringify({
            values,
            rows: Object.fromEntries(Object.entries(rows).map(([k, l]) => [k, l.filter(Boolean)])),
            activities: fd.getAll('act').map(String),
          }),
        })
      ).refused ?? [];
  } catch (error) {
    back(fd, error);
  }
  if (refused.length) {
    const school = str(fd, 'school');
    const apply = str(fd, 'apply');
    redirect(
      `/${school}/careers/form${okId(apply) ? `?apply=${apply}&` : '?'}warn=1&detail=${encodeURIComponent(refused.join('; ').slice(0, 600))}`,
    );
  }
  done(fd, 'Saved.', '#apply');
}

/** One document: an upload slot, the bytes, then the file becomes the document of that kind. */
export async function uploadCareerDoc(fd: FormData) {
  const kind = str(fd, 'kind');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0)
    back(
      fd,
      new PublicApiError(400, { type: 'validation-failed', detail: 'Choose a file' }),
      '#docs',
    );
  const f = file as File;
  try {
    const slot = await careersFetch<{
      file: { id: string };
      upload: { url: string; method?: string; headers?: Record<string, string> };
    }>('/me/files/slot', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        fileName: f.name.slice(0, 200),
        contentType: f.type,
        sizeBytes: f.size,
      }),
    });
    const target = slot.upload.url.startsWith('http')
      ? slot.upload.url
      : `${API}${slot.upload.url}`;
    const headers = new Headers({ 'content-type': f.type });
    for (const [k, v] of Object.entries(slot.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: slot.upload.method || 'PUT',
      headers,
      body: Buffer.from(await f.arrayBuffer()),
    });
    if (!put.ok)
      throw new PublicApiError(put.status, {
        type: 'file.upload_failed',
        detail: `${f.name} did not upload`,
      });
    await careersFetch('/me/files', {
      method: 'POST',
      body: JSON.stringify({ kind, fileId: slot.file.id }),
    });
  } catch (error) {
    back(fd, error, '#docs');
  }
  done(fd, 'Uploaded.', '#docs');
}

export async function removeCareerDoc(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id))
    back(fd, new PublicApiError(404, { type: 'not-found', detail: 'Not found' }), '#docs');
  try {
    await careersFetch(`/me/files/${id}`, { method: 'DELETE' });
  } catch (error) {
    back(fd, error, '#docs');
  }
  done(fd, 'Removed.', '#docs');
}

export async function applyCareer(fd: FormData) {
  const school = str(fd, 'school');
  const vacancy = str(fd, 'apply');
  let number = '';
  try {
    number = (
      await careersFetch<{ number: string }>(`/vacancies/${vacancy}/apply`, {
        method: 'POST',
        body: JSON.stringify({ declaration: fd.get('declaration') === 'yes' }),
      })
    ).number;
  } catch (error) {
    back(fd, error, '#apply');
  }
  redirect(`/${school}/careers/mine?applied=${encodeURIComponent(number)}`);
}
