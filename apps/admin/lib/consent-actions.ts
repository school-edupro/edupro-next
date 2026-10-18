'use server';
/** Consent forms (docs/design/28-consent-forms.md): build, publish, close, notify, fill on behalf. */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
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

type Messages = Array<{ channel: string; status?: string; people?: number; error?: string }>;
/** The SMS / WhatsApp / email templates chosen on the form (tpl_sms, tpl_whatsapp, tpl_email). */
const channelsOf = (fd: FormData) =>
  (['sms', 'whatsapp', 'email'] as const)
    .map((channel) => ({ channel, templateId: str(fd, `tpl_${channel}`) }))
    .filter((x) => /^\d+$/.test(x.templateId));
/** What became of each channel, for the notice: "SMS: waiting for approval; Email: not sent (…)". */
const messageQs = (m: Messages) =>
  m.length
    ? `&msg=${encodeURIComponent(
        m
          .map((x) =>
            x.error
              ? `${x.channel}: not sent (${x.error.slice(0, 80)})`
              : `${x.channel} to ${x.people ?? 0}: ${x.status === 'pending_approval' ? 'waiting for message approval' : (x.status ?? 'queued')}`,
          )
          .join('; ')
          .slice(0, 400),
      )}`
    : '';

/** Publish (with the app notification and the chosen channels), close, reopen or archive. */
export async function setConsentStatus(fd: FormData) {
  const id = str(fd, 'id');
  let told = 0;
  let messages: Messages = [];
  try {
    const r = await apiFetch<{ told?: number; messages?: Messages }>(`${BASE}/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status: str(fd, 'status'),
        // the publish form says it with a tick; the other buttons with push=no
        push: fd.has('pushForm') ? fd.has('pushOn') : str(fd, 'push') !== 'no',
        channels: channelsOf(fd),
      }),
    });
    told = r.told ?? 0;
    messages = r.messages ?? [];
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=${str(fd, 'status')}&told=${told}${messageQs(messages)}`);
}

export async function notifyConsentPending(fd: FormData) {
  const id = str(fd, 'id');
  const back2 = `${BASE}/${id}?tab=pending`;
  // the ticked people (only when "only those ticked"), the channels ticked with their templates
  const people =
    str(fd, 'who') === 'all'
      ? undefined
      : fd
          .getAll('person')
          .map(String)
          .map((v) => /^(student|employee):(\d+)$/.exec(v))
          .filter((m): m is RegExpExecArray => Boolean(m))
          .map((m) => ({ kind: m[1] as 'student' | 'employee', id: m[2]! }));
  if (people && !people.length)
    redirect(
      `${back2}&error=consent.nobody&detail=${encodeURIComponent('Tick at least one person, or choose all.')}`,
    );
  const channels = channelsOf(fd).filter((x) => fd.get(`ch_${x.channel}`) === 'on');
  const app = fd.get('ch_app') === 'on';
  let r: { people: number; told: number; messages: Messages } = {
    people: 0,
    told: 0,
    messages: [],
  };
  try {
    r = await apiFetch<{ people: number; told: number; messages: Messages }>(
      `${BASE}/${id}/notify`,
      {
        method: 'POST',
        body: JSON.stringify({
          channels,
          app,
          people,
          sectionId: str(fd, 'sectionId') || undefined,
          q: str(fd, 'q') || undefined,
        }),
      },
    );
  } catch (error) {
    back(back2, error);
  }
  redirect(`${back2}&ok=notified&people=${r.people}&told=${r.told}${messageQs(r.messages)}`);
}

/** Approve or reject an answer at my level (from the response page). */
export async function decideConsent(fd: FormData) {
  const id = str(fd, 'formId');
  const rid = str(fd, 'responseId');
  try {
    await apiFetch(`/engagement/mine/consent-approvals/${str(fd, 'stepId')}`, {
      method: 'POST',
      body: JSON.stringify({
        decision: str(fd, 'decision') === 'rejected' ? 'rejected' : 'approved',
        note: str(fd, 'note') || undefined,
      }),
    });
  } catch (error) {
    back(`${BASE}/${id}/responses/${rid}`, error);
  }
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}/responses/${rid}?ok=${str(fd, 'decision')}`);
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

/** A new public link: the old link and QR stop working. */
export async function rotateConsentLink(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`${BASE}/${id}/public-link`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(`${BASE}/${id}`, error);
  }
  redirect(`${BASE}/${id}?ok=link`);
}

// ---- webhooks and API keys (part 4) ----
const integ = (id: string) => `${BASE}/${id}/integrations`;
/** A secret or key shown once: kept a minute in an HttpOnly cookie for the page, never in the URL. */
async function flash(id: string, label: string, value: string) {
  (await cookies()).set('cf_once', JSON.stringify({ label, value }), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: `/engagement/consent-forms/${id}/connect`,
    maxAge: 60,
  });
}

export async function addConsentWebhook(fd: FormData) {
  const id = str(fd, 'id');
  try {
    const r = await apiFetch<{ secret: string }>(`${integ(id)}/webhooks`, {
      method: 'POST',
      body: JSON.stringify({ url: str(fd, 'url'), events: fd.getAll('events').map(String) }),
    });
    await flash(id, 'Signing secret of the new webhook', r.secret);
  } catch (error) {
    back(`${BASE}/${id}/connect`, error);
  }
  redirect(`${BASE}/${id}/connect?ok=webhook`);
}

export async function updateConsentWebhook(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`${integ(id)}/webhooks/${str(fd, 'hookId')}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: str(fd, 'active') === 'true' }),
    });
  } catch (error) {
    back(`${BASE}/${id}/connect`, error);
  }
  redirect(`${BASE}/${id}/connect?ok=saved`);
}

export async function consentWebhookAction(fd: FormData) {
  const id = str(fd, 'id');
  const hook = str(fd, 'hookId');
  const what = str(fd, 'what');
  try {
    if (what === 'test')
      await apiFetch(`${integ(id)}/webhooks/${hook}/test`, { method: 'POST', body: '{}' });
    else if (what === 'secret') {
      const r = await apiFetch<{ secret: string }>(`${integ(id)}/webhooks/${hook}/secret`, {
        method: 'POST',
        body: '{}',
      });
      await flash(id, 'New signing secret', r.secret);
    } else if (what === 'remove')
      await apiFetch(`${integ(id)}/webhooks/${hook}`, { method: 'DELETE' });
    else if (what === 'retry')
      await apiFetch(`${integ(id)}/deliveries/${str(fd, 'deliveryId')}/retry`, {
        method: 'POST',
        body: '{}',
      });
  } catch (error) {
    back(`${BASE}/${id}/connect`, error);
  }
  redirect(`${BASE}/${id}/connect?ok=${what}`);
}

export async function addConsentKey(fd: FormData) {
  const id = str(fd, 'id');
  try {
    const r = await apiFetch<{ key: string }>(`${integ(id)}/keys`, {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        scope: str(fd, 'scope') === 'read_approve' ? 'read_approve' : 'read',
        expiresOn: str(fd, 'expiresOn') || undefined,
      }),
    });
    await flash(id, 'The new API key', r.key);
  } catch (error) {
    back(`${BASE}/${id}/connect`, error);
  }
  redirect(`${BASE}/${id}/connect?ok=key`);
}

export async function revokeConsentKey(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`${integ(id)}/keys/${str(fd, 'keyId')}`, { method: 'DELETE' });
  } catch (error) {
    back(`${BASE}/${id}/connect`, error);
  }
  redirect(`${BASE}/${id}/connect?ok=revoked`);
}

// ---- my own forms (a staff member working in admin) ----
async function answersWithFiles(fd: FormData) {
  const answers = JSON.parse(str(fd, 'answers') || '{}') as Record<string, unknown>;
  for (const key of new Set(
    [...fd.keys()].filter((k) => k.startsWith('file__')).map((k) => k.slice(6)),
  )) {
    if (fd.get(`skip__${key}`)) continue;
    const ids = await uploadAll(fd, `file__${key}`);
    if (ids.length) answers[key] = ids;
  }
  return answers;
}

/** A staff member answers a form for themself (as in the staff app). */
export async function answerMyForm(fd: FormData) {
  const formId = str(fd, 'formId');
  let out: { number: string; success: string | null } | undefined;
  try {
    out = await apiFetch<{ number: string; success: string | null }>(
      `/engagement/mine/consent-forms/${formId}/responses`,
      {
        method: 'POST',
        body: JSON.stringify({
          answers: await answersWithFiles(fd),
          signedName: str(fd, 'signedName') || undefined,
        }),
      },
    );
  } catch (error) {
    back(`/my-forms/${formId}`, error);
  }
  redirect(
    `/my-forms?ok=answered&detail=${encodeURIComponent(`Saved as ${out!.number}.${out!.success ? ` ${out!.success}` : ''}`)}`,
  );
}

/** A staff member changes their answer (until the form's edit date, before it is decided). */
export async function changeMyForm(fd: FormData) {
  const formId = str(fd, 'formId');
  const rid = str(fd, 'responseId');
  let out: { number: string } | undefined;
  try {
    out = await apiFetch<{ number: string }>(`/engagement/mine/consent-forms/responses/${rid}`, {
      method: 'PUT',
      body: JSON.stringify({
        answers: await answersWithFiles(fd),
        signedName: str(fd, 'signedName') || undefined,
      }),
    });
  } catch (error) {
    back(`/my-forms/${formId}?response=${rid}`, error);
  }
  redirect(
    `/my-forms?ok=changed&detail=${encodeURIComponent(`Your answer ${out!.number} is changed.`)}`,
  );
}

type Share = { userId?: string; roleId?: string; level: 'viewer' | 'editor' };
/** Add, change or remove one share of a form: the whole list is read and saved again. */
export async function changeConsentShare(fd: FormData) {
  const id = str(fd, 'id');
  const path = `${BASE}/${id}/share`;
  const op = str(fd, 'op');
  const level = str(fd, 'level') === 'editor' ? 'editor' : 'viewer';
  // the one being added or changed: "u:<user id>" or "r:<role id>"
  const m = /^(u|r):(\d+)$/.exec(str(fd, 'who'));
  if (!m)
    redirect(
      `${path}?error=validation-failed&detail=${encodeURIComponent('Choose a person or a role.')}`,
    );
  const key = (x: Share) => (x.userId ? `u:${x.userId}` : `r:${x.roleId}`);
  const who = `${m[1]}:${m[2]}`;
  try {
    const now = await apiFetch<{
      data: Array<{ userId: string | null; roleId: string | null; level: Share['level'] }>;
    }>(`${BASE}/${id}/shares`);
    let list: Share[] = now.data.map((x) =>
      x.userId ? { userId: x.userId, level: x.level } : { roleId: x.roleId!, level: x.level },
    );
    list = list.filter((x) => key(x) !== who);
    if (op !== 'remove')
      list.push(m[1] === 'u' ? { userId: m[2]!, level } : { roleId: m[2]!, level });
    await apiFetch(`${BASE}/${id}/shares`, {
      method: 'PUT',
      body: JSON.stringify({ shares: list }),
    });
  } catch (error) {
    back(path, error);
  }
  revalidatePath(path);
  redirect(`${path}?ok=${op === 'remove' ? 'removed' : 'shared'}`);
}
