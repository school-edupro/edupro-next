'use server';
/** Employee exit (docs/design/38, part 5): set-up, the office's exits and the decisions. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type { ApprovalLevel } from './recruitment';
import type { EmployeeType, ExitDetail, ExitRow, ExitSetup } from './exits';

type Out<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);

async function call<T>(
  path: string,
  method: string,
  body: unknown,
  paths: string[],
): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) {
      const errors = e.problem.errors as Record<string, string> | undefined;
      const first = errors && !Array.isArray(errors) ? Object.values(errors)[0] : undefined;
      return { ok: false, error: e.problem.detail ?? first ?? e.problem.type };
    }
    throw e;
  }
}

export async function saveExitSetup(body: Omit<ExitSetup, 'employeeTypes' | 'can'>) {
  return call('/people/exits/setup', 'PUT', body, ['/people/exits/setup']);
}

export async function saveExitApproval(
  type: EmployeeType,
  levels: ApprovalLevel[],
): Promise<{ ok: true; moved: number; approved: number } | { ok: false; error: string }> {
  const r = await call<{ moved: number; approved: number }>(
    `/people/exits/setup/approval/${type}`,
    'PUT',
    {
      levels: levels.map((l) => ({
        name: l.name.trim(),
        by: l.by,
        employeeIds: l.by === 'employees' ? l.employeeIds : [],
        ...(l.by === 'designation' && l.designation ? { designation: l.designation } : {}),
        ...(l.by === 'role' && l.roleCode ? { roleCode: l.roleCode } : {}),
        slaHours: l.slaHours,
      })),
    },
    ['/people/exits/setup'],
  );
  return r.ok ? { ok: true, moved: r.data.moved, approved: r.data.approved } : r;
}

export async function createExit(body: {
  employeeId: string;
  exitType: string;
  reason: string;
  letterFileId?: string | null;
  requestedOn?: string;
  proposedLastDay?: string;
}) {
  return call<ExitRow>('/people/exits', 'POST', body, ['/people/exits']);
}

export async function decideExit(
  id: string,
  action: 'approve' | 'send-back' | 'reject',
  body: { note?: string; acceptedLastDay?: string; waiveNotice?: boolean },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown exit' };
  return call<ExitDetail>(`/people/exits/${id}/${action}`, 'POST', body, [
    '/people/exits',
    `/people/exits/${id}`,
  ]);
}

export async function withdrawExit(id: string, reason?: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown exit' };
  return call<ExitDetail>(`/people/exits/${id}/withdraw`, 'POST', { reason }, [
    '/people/exits',
    `/people/exits/${id}`,
  ]);
}

export async function resubmitExit(
  id: string,
  body: { reason?: string; proposedLastDay?: string; letterFileId?: string | null },
) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown exit' };
  return call<ExitDetail>(`/people/exits/${id}/resubmit`, 'POST', body, [
    '/people/exits',
    `/people/exits/${id}`,
  ]);
}

/** A letter (PDF or photo) uploaded through the file service; its id goes with the exit. */
export async function uploadExitLetter(fd: FormData): Promise<Out<{ id: string }>> {
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a file' };
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
    return { ok: false, error: 'Attach a PDF or a photo (PNG, JPEG, WebP)' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'The file is larger than 5 MB' };
  try {
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
    if (!put.ok) return { ok: false, error: 'The file did not upload' };
    return { ok: true, data: { id: reg.file.id } };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}

/** Active employees matching a name or code (the office's "record an exit"). */
export async function findEmployees(q: string): Promise<
  Array<{
    id: string;
    code: string;
    name: string;
    type: EmployeeType;
    department: string | null;
    designation: string | null;
  }>
> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const r = await apiFetch<{
    data: Array<{
      id: string;
      employeeCode: string;
      displayName: string;
      employeeType: EmployeeType;
      department: string | null;
      designation: string | null;
    }>;
  }>(`/people/employees?q=${encodeURIComponent(term)}&status=active&size=10`).catch(() => ({
    data: [],
  }));
  return r.data.map((e) => ({
    id: e.id,
    code: e.employeeCode,
    name: e.displayName,
    type: e.employeeType,
    department: e.department,
    designation: e.designation,
  }));
}
