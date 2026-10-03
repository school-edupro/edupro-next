'use server';
/**
 * Helpdesk server actions (0056). Ticket forms post here and come back to the ticket with ?ok / ?error;
 * files chosen in a form are uploaded through the file service first (PDF or image, 5 MB each, up to 5).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { Head, HelpdeskSettings, Level, Setup } from './helpdesk';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

function back(path: string, error: unknown): never {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as
      Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
    const detail = Array.isArray(errs)
      ? errs.map((e) => [e.path, e.message].filter(Boolean).join(': ')).join('; ')
      : errs && typeof errs === 'object'
        ? Object.values(errs).join('; ')
        : (error.problem.detail ?? '');
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(detail).slice(0, 300))}`,
    );
  }
  throw error;
}

/** Uploads the files of a form field; returns their ids. */
async function uploadAll(fd: FormData, key = 'files'): Promise<string[]> {
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

const ticketPath = (desk: string, id: string) => `/engagement/helpdesk/${desk}/${id}`;

export async function raiseTicket(fd: FormData) {
  const desk = str(fd, 'desk') === 'provider' ? 'provider' : 'staff';
  let id = '';
  try {
    const fileIds = await uploadAll(fd);
    id = (
      await apiFetch<{ id: string }>('/helpdesk/tickets', {
        method: 'POST',
        body: JSON.stringify({
          desk,
          categoryCode: str(fd, 'categoryCode'),
          subject: str(fd, 'subject'),
          body: str(fd, 'body'),
          priority: str(fd, 'priority') || 'normal',
          module: str(fd, 'module') || undefined,
          fileIds,
        }),
      })
    ).id;
  } catch (error) {
    back(`/engagement/helpdesk/${desk}/new`, error);
  }
  revalidatePath('/engagement/helpdesk');
  redirect(`${ticketPath(desk, id)}?ok=raised`);
}

async function act(
  fd: FormData,
  what: string,
  body: (fileIds: string[]) => Record<string, unknown>,
) {
  const id = str(fd, 'id');
  const desk = str(fd, 'desk');
  const path = ticketPath(desk, id);
  try {
    const fileIds = await uploadAll(fd);
    await apiFetch(`/helpdesk/tickets/${id}/${what}`, {
      method: 'POST',
      body: JSON.stringify(body(fileIds)),
    });
  } catch (error) {
    back(path, error);
  }
  revalidatePath(path);
  redirect(`${path}?ok=${what}`);
}

export async function replyTicket(fd: FormData) {
  await act(fd, 'replies', (fileIds) => ({
    body: str(fd, 'body'),
    fileIds,
    isInternal: fd.get('isInternal') === 'on',
  }));
}

export async function assignTicket(fd: FormData) {
  const to = str(fd, 'to');
  await act(fd, 'assign', () => ({
    ...(to.startsWith('role:') ? { roleCode: to.slice(5) } : { userId: to.replace(/^user:/, '') }),
    note: str(fd, 'note') || undefined,
  }));
}

export async function closeTicket(fd: FormData) {
  await act(fd, 'close', (fileIds) => ({ resolution: str(fd, 'resolution'), fileIds }));
}

export async function reopenTicket(fd: FormData) {
  await act(fd, 'reopen', (fileIds) => ({ reason: str(fd, 'reason'), fileIds }));
}

export async function rateTicket(fd: FormData) {
  await act(fd, 'rate', () => ({
    rating: Number(str(fd, 'rating')),
    comment: str(fd, 'comment') || undefined,
  }));
}

export async function takeOverTicket(fd: FormData) {
  await act(fd, 'take-over', () => ({}));
}

export async function escalateNow() {
  let n = 0;
  try {
    n = (
      await apiFetch<{ escalated: number }>('/helpdesk/escalate-now', {
        method: 'POST',
        body: '{}',
      })
    ).escalated;
  } catch (error) {
    back('/engagement/helpdesk/setup', error);
  }
  revalidatePath('/engagement/helpdesk');
  redirect(
    `/engagement/helpdesk/setup?ok=escalated&detail=${encodeURIComponent(`${String(n)} ticket(s) moved`)}`,
  );
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function result<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath('/engagement/helpdesk/setup');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as Array<{ path?: string; message?: string }> | undefined;
      const list = Array.isArray(errs) ? errs.map((e) => e.message).filter(Boolean) : [];
      return {
        ok: false,
        error: list.length ? list.join('; ') : (error.problem.detail ?? error.problem.type),
      };
    }
    throw error;
  }
}

export async function saveHelpdeskSettings(s: HelpdeskSettings) {
  return result(() =>
    apiFetch<Setup>('/helpdesk/setup/settings', { method: 'PUT', body: JSON.stringify(s) }),
  );
}

export async function saveHead(
  id: string | null,
  h: Omit<Head, 'id' | 'used' | 'ownerName' | 'levels'> & { levels: Level[] },
) {
  const body = {
    desk: h.desk,
    code: h.code,
    name: h.name,
    description: h.description || undefined,
    ownerType: h.ownerType,
    ownerRole: h.ownerType === 'role' ? (h.ownerRole ?? undefined) : undefined,
    ownerUserId: h.ownerType === 'employee' ? (h.ownerUserId ?? undefined) : undefined,
    slaHours: h.desk === 'provider' ? null : h.slaHours,
    sortOrder: h.sortOrder,
    active: h.active,
    levels: h.levels.map((l) => ({
      level: l.level,
      hours: l.hours,
      assignType: l.assignType,
      roleCode: l.assignType === 'role' ? (l.roleCode ?? undefined) : undefined,
      userId: l.assignType === 'employee' ? (l.userId ?? undefined) : undefined,
      emails: l.emails,
    })),
  };
  return result(() =>
    apiFetch<Setup>(id ? `/helpdesk/setup/heads/${id}` : '/helpdesk/setup/heads', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),
  );
}

/** Queues the desk list (with the filters on screen) as a PDF and returns to the desk to watch it. */
export async function exportTicketsPdf(fd: FormData) {
  const desk = str(fd, 'desk');
  const path = `/engagement/helpdesk/${['parent', 'staff', 'provider'].includes(desk) ? desk : 'staff'}`;
  const filters: Record<string, string> = {};
  for (const k of ['status', 'view', 'head', 'q']) {
    const v = str(fd, k);
    if (v) filters[k] = v;
  }
  const here = `${path}?${new URLSearchParams(filters).toString()}`;
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/helpdesk/tickets/export-pdf', {
        method: 'POST',
        body: JSON.stringify({ desk, ...filters }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  redirect(`${here}&export=${id}`);
}
