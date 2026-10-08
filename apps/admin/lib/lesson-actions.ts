'use server';
/** The lesson planner (0097): upload, acknowledge or reject, delete, and who approves whose lessons. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};

async function uploadFiles(fd: FormData): Promise<string[]> {
  const ids: string[] = [];
  for (const file of fd.getAll('files')) {
    if (!(file instanceof File) || file.size === 0) continue;
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
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${process.env.API_BASE_URL ?? 'http://localhost:4000'}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok) throw new ApiError(put.status, { type: 'file.upload_failed' });
    ids.push(reg.file.id);
  }
  return ids;
}

export async function uploadLesson(fd: FormData) {
  let id = '';
  try {
    const fileIds = await uploadFiles(fd);
    const r = await apiFetch<{ id: string }>('/academics/lessons', {
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
    fail('/academics/lesson-plans?tab=upload', error);
  }
  redirect(`/academics/lesson-plans/${id}?ok=uploaded`);
}

async function decide(fd: FormData, action: 'acknowledge' | 'reject') {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/academics/lessons/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ action, remark: str(fd, 'remark') || undefined }),
    });
  } catch (error) {
    fail(`/academics/lesson-plans/${id}`, error);
  }
  redirect(`/academics/lesson-plans/${id}?ok=${action}`);
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
    await apiFetch(`/academics/lessons/${id}`, { method: 'DELETE' });
  } catch (error) {
    fail(`/academics/lesson-plans/${id}`, error);
  }
  redirect('/academics/lesson-plans?ok=deleted');
}

/** One rule: whose lessons (an employee, a class, a department, or everyone else) and up to three levels. */
export async function saveLessonApprovers(fd: FormData) {
  const here = '/academics/lesson-plans?tab=approvers';
  const levels = [1, 2, 3]
    .map((n) => str(fd, `level${String(n)}`))
    .filter(Boolean)
    .map((v) =>
      v.startsWith('role:')
        ? { kind: 'role', roleCode: v.slice(5) }
        : { kind: 'employee', employeeId: v.replace(/^emp:/, '') },
    );
  const scope = str(fd, 'scope');
  try {
    await apiFetch('/academics/lessons/approvers', {
      method: 'POST',
      body: JSON.stringify({
        scope,
        employeeId: scope === 'employee' ? str(fd, 'employeeId') || undefined : undefined,
        classId: scope === 'class' ? str(fd, 'classId') || undefined : undefined,
        department: scope === 'department' ? str(fd, 'department') || undefined : undefined,
        levels,
      }),
    });
  } catch (error) {
    fail(here, error);
  }
  redirect(`${here}&ok=1`);
}

export async function removeLessonApprovers(fd: FormData) {
  const here = '/academics/lesson-plans?tab=approvers';
  try {
    await apiFetch(`/academics/lessons/approvers/${str(fd, 'id')}`, { method: 'DELETE' });
  } catch (error) {
    fail(here, error);
  }
  redirect(`${here}&ok=1`);
}
