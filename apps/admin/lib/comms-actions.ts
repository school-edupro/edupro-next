'use server';
/**
 * Server actions of the communication v2 screens (client components call these and get a Result
 * back instead of a redirect, so long forms keep their state).
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type {
  Attachment,
  Channel,
  CommsPolicy,
  CommsTemplate,
  ComposePayload,
  ComposePreview,
  Group,
  Member,
  Result,
  Rule,
  SheetResult,
  TemplatePreview,
} from './comms';

async function call<T>(fn: () => Promise<T>, revalidate?: string): Promise<Result<T>> {
  try {
    const data = await fn();
    if (revalidate) revalidatePath(revalidate);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs =
        (error.problem.errors as Array<{ path?: string; message?: string }> | undefined) ?? [];
      return {
        ok: false,
        error: error.problem.detail ?? error.problem.title ?? error.problem.type,
        errors: errs.map((e) => [e.path, e.message].filter(Boolean).join(': ')),
      };
    }
    throw error;
  }
}

const base64Of = async (file: File) => Buffer.from(await file.arrayBuffer()).toString('base64');

// ---- compose ----------------------------------------------------------------------------------------
export async function composePreview(p: ComposePayload) {
  return call(() =>
    apiFetch<ComposePreview>('/comms/requests/preview', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  );
}

export async function composeSend(p: ComposePayload) {
  return call(
    () =>
      apiFetch<{ id: string; status: string; needsApproval: boolean }>('/comms/requests', {
        method: 'POST',
        body: JSON.stringify(p),
      }),
    '/comms/requests',
  );
}

/** The email exactly as the first recipient gets it, sent to the signed-in user first. */
export async function composeTestEmail(p: ComposePayload) {
  return call(() =>
    apiFetch<{ to: string; as: string; messageId: string }>('/comms/requests/test-email', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  );
}

export async function readRecipientSheet(fd: FormData) {
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size)
    return { ok: false, error: 'Choose an Excel file' } as const;
  const name = file.name.toLowerCase();
  return call(async () =>
    apiFetch<SheetResult>('/comms/requests/recipients-sheet', {
      method: 'POST',
      body: JSON.stringify(
        name.endsWith('.csv')
          ? { csv: await file.text() }
          : { contentBase64: await base64Of(file) },
      ),
    }),
  );
}

/** Uploads one attachment through the file service; the API checks type and size when sending. */
export async function uploadAttachment(fd: FormData): Promise<Result<Attachment>> {
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) return { ok: false, error: 'Choose a file' };
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
    return { ok: false, error: 'Attach a PDF or an image (PNG, JPEG, WebP)' };
  return call(async () => {
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
    if (!put.ok)
      throw new ApiError(put.status, {
        type: 'file.upload_failed',
        detail: 'The file did not upload',
      });
    return { id: reg.file.id, name: file.name, size: file.size, contentType: file.type };
  });
}

// ---- templates --------------------------------------------------------------------------------------
export async function previewTemplate(p: {
  channel: Channel;
  subject?: string;
  body: string;
  format: 'text' | 'html';
}) {
  return call(() =>
    apiFetch<TemplatePreview>('/comms/templates/preview', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  );
}

export async function saveTemplate(id: string | null, p: Record<string, unknown>) {
  return call(
    () =>
      id
        ? apiFetch<CommsTemplate>(`/comms/templates/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(p),
          })
        : apiFetch<CommsTemplate>('/comms/templates', { method: 'POST', body: JSON.stringify(p) }),
    '/comms/templates',
  );
}

export async function deleteTemplate(id: string) {
  return call(() => apiFetch(`/comms/templates/${id}`, { method: 'DELETE' }), '/comms/templates');
}

// ---- groups -----------------------------------------------------------------------------------------
export async function createGroupV2(p: {
  code: string;
  name: string;
  description?: string;
  kind: string;
  mode: 'static' | 'rule';
  rule?: Rule;
}) {
  return call(
    () => apiFetch<Group>('/comms/groups', { method: 'POST', body: JSON.stringify(p) }),
    '/comms/groups',
  );
}

export async function updateGroupV2(
  id: string,
  p: { name?: string; description?: string | null; rule?: Rule },
) {
  return call(
    () => apiFetch<Group>(`/comms/groups/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
    `/comms/groups/${id}`,
  );
}

export async function deleteGroupV2(id: string) {
  return call(() => apiFetch(`/comms/groups/${id}`, { method: 'DELETE' }), '/comms/groups');
}

export async function changeMembers(
  id: string,
  add: Array<{ type: string; id: string }>,
  remove: Array<{ type: string; id: string }>,
) {
  return call(
    () =>
      apiFetch<{ members: Member[] }>(`/comms/groups/${id}/members`, {
        method: 'PUT',
        body: JSON.stringify({ add, remove }),
      }),
    `/comms/groups/${id}`,
  );
}

export async function searchPeople(q: string, types: string) {
  return call(() =>
    apiFetch<{ data: Member[] }>(
      `/comms/groups/people?q=${encodeURIComponent(q)}&types=${encodeURIComponent(types)}`,
    ),
  );
}

export async function uploadGroupMembers(fd: FormData) {
  const id = String(fd.get('id') ?? '');
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size)
    return { ok: false, error: 'Choose an Excel file' } as const;
  const body = file.name.toLowerCase().endsWith('.csv')
    ? { csv: await file.text() }
    : { contentBase64: await base64Of(file) };
  return call(
    () =>
      apiFetch<{
        rows: number;
        matched: number;
        problems: Array<{ row: number; value: string; reason: string }>;
        dryRun: boolean;
        group: Group;
      }>(`/comms/groups/${id}/upload`, {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          mode: fd.get('mode') === 'replace' ? 'replace' : 'add',
          dryRun: fd.get('dryRun') !== 'false',
        }),
      }),
    `/comms/groups/${id}`,
  );
}

// ---- settings ---------------------------------------------------------------------------------------
export async function savePolicy(p: CommsPolicy) {
  return call(
    () => apiFetch<CommsPolicy>('/comms/settings', { method: 'PUT', body: JSON.stringify(p) }),
    '/comms/settings',
  );
}

export async function saveProvider(
  channel: Channel,
  p: {
    provider: string;
    config: Record<string, string | number | boolean>;
    secrets: Record<string, string>;
    active: boolean;
  },
) {
  return call(
    () => apiFetch(`/comms/providers/${channel}`, { method: 'PUT', body: JSON.stringify(p) }),
    '/comms/settings',
  );
}

export async function testProvider(channel: Channel, to: string, templateId?: string) {
  return call(() =>
    apiFetch<{ messageId: string }>(`/comms/providers/${channel}/test`, {
      method: 'POST',
      body: JSON.stringify({ to, ...(templateId ? { templateId } : {}) }),
    }),
  );
}

export async function addCredit(p: {
  channel: Channel;
  units: number;
  amount?: number;
  note?: string;
}) {
  return call(
    () => apiFetch('/comms/credits', { method: 'POST', body: JSON.stringify(p) }),
    '/comms/settings',
  );
}

/** Queues a communication report as Excel or PDF and returns to the reports page to watch it. */
export async function commsExport(fd: FormData) {
  const { redirect } = await import('next/navigation');
  const dataset = String(fd.get('dataset') ?? '');
  const format = fd.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  if (!['comms_monthly_usage', 'comms_delivery_log', 'comms_failures'].includes(dataset))
    redirect('/comms/reports?error=validation-failed');
  const params: Record<string, string> = {};
  for (const k of ['from', 'to', 'channel', 'status']) {
    const v = String(fd.get(k) ?? '').trim();
    if (v) params[k] = v;
  }
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/reports/exports', {
        method: 'POST',
        body: JSON.stringify({ dataset, format, params }),
      })
    ).id;
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        `/comms/reports?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? '')}`,
      );
    throw error;
  }
  const q = new URLSearchParams({ ...params, export: id, format });
  redirect(`/comms/reports?${q.toString()}`);
}

export async function saveCustomVariable(p: { key: string; label: string; value: string }) {
  return call(
    () => apiFetch('/comms/variables', { method: 'PUT', body: JSON.stringify(p) }),
    '/comms/templates',
  );
}

export async function deleteCustomVariable(key: string) {
  return call(
    () => apiFetch(`/comms/variables/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    '/comms/templates',
  );
}
