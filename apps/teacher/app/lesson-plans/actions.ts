'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const API =
  process.env.INTERNAL_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';

function fail(back: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') || (typeof error.problem.detail === 'string' ? error.problem.detail : '');
    redirect(
      `${back}${back.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
}

/** Uploads the attachments of the form through the file service; returns their ids. */
async function uploadFiles(fd: FormData): Promise<string[]> {
  const ids: string[] = [];
  for (const file of fd.getAll('files')) {
    if (!(file instanceof File) || file.size === 0) continue;
    const reg = await bff.api.fetch<{
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
        detail: `${file.name} could not be uploaded.`,
      });
    ids.push(reg.file.id);
  }
  return ids;
}

/** Upload Lesson: the lesson goes to its approvers. */
export async function uploadLesson(fd: FormData) {
  let id = '';
  try {
    const fileIds = await uploadFiles(fd);
    const r = await bff.api.fetch<{ id: string }>('/academics/lessons', {
      method: 'POST',
      body: JSON.stringify({
        date: str(fd, 'date'),
        targetType: str(fd, 'targetType') === 'section' ? 'section' : 'class',
        classIds: fd.getAll('classIds').map(String),
        sectionIds: fd.getAll('sectionIds').map(String),
        topic: str(fd, 'topic'),
        description: str(fd, 'description') || undefined,
        fileIds,
      }),
    });
    id = r.id;
  } catch (error) {
    fail('/lesson-plans', error);
  }
  redirect(`/lesson-plans/${id}?ok=uploaded`);
}

async function decide(fd: FormData, action: 'acknowledge' | 'reject') {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/academics/lessons/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ action, remark: str(fd, 'remark') || undefined }),
    });
  } catch (error) {
    fail(`/lesson-plans/${id}`, error);
  }
  redirect(`/lesson-plans/${id}?ok=${action}`);
}
export async function acknowledgeLesson(fd: FormData) {
  return decide(fd, 'acknowledge');
}
export async function rejectLesson(fd: FormData) {
  return decide(fd, 'reject');
}

export async function deleteLesson(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await bff.api.fetch(`/academics/lessons/${id}`, { method: 'DELETE' });
  } catch (error) {
    fail(`/lesson-plans/${id}`, error);
  }
  redirect('/lesson-plans?tab=report&ok=deleted');
}
