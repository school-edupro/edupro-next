'use server';
/**
 * Server actions: the only place the admin app writes to the API. Each action calls the API with the
 * session token (ADR-007), then redirects back with a status so pages stay server-rendered forms.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

function back(path: string, status: 'ok' | string, detail?: string): never {
  const params = new URLSearchParams();
  params.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) params.set('detail', detail.slice(0, 200));
  revalidatePath(path);
  redirect(`${path}?${params.toString()}`);
}

async function run(path: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, error.problem.detail);
    throw error;
  }
  back(path, 'ok');
}

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const opt = (fd: FormData, key: string): string | undefined => str(fd, key) || undefined;

// ---- roles ---------------------------------------------------------------------------------------
export async function createRole(fd: FormData) {
  return run('/access/roles', () =>
    apiFetch('/access/roles', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        kind: str(fd, 'kind') || 'module',
        description: str(fd, 'description'),
        copyFromRoleId: opt(fd, 'copyFromRoleId'),
        permissions: fd.getAll('permissions').map(String),
      }),
    }),
  );
}

export async function updateRole(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/access/roles/${id}`, () =>
    apiFetch(`/access/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        description: str(fd, 'description'),
        status: str(fd, 'status') || 'active',
        permissions: fd.getAll('permissions').map(String),
      }),
    }),
  );
}

export async function disableRole(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/roles', () => apiFetch(`/access/roles/${id}`, { method: 'DELETE' }));
}

// ---- assignments ---------------------------------------------------------------------------------
export async function grantRole(fd: FormData) {
  return run('/access/assignments', () =>
    apiFetch('/access/assignments', {
      method: 'POST',
      body: JSON.stringify({
        userId: str(fd, 'userId'),
        roleId: str(fd, 'roleId'),
        campusId: opt(fd, 'campusId'),
        validFrom: opt(fd, 'validFrom'),
        validTo: opt(fd, 'validTo'),
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function revokeAssignment(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/assignments', () =>
    apiFetch(`/access/assignments/${id}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') || 'revoked from admin' }),
    }),
  );
}

export async function setAssignmentScopes(fd: FormData) {
  const id = str(fd, 'id');
  const scopes = fd.getAll('sectionIds').map((v) => ({ type: 'class_section', id: String(v) }));
  return run(`/access/assignments/${id}`, () =>
    apiFetch(`/access/assignments/${id}/scopes`, {
      method: 'PUT',
      body: JSON.stringify({ scopes }),
    }),
  );
}

// ---- memberships ---------------------------------------------------------------------------------
export async function inviteMember(fd: FormData) {
  return run('/access/memberships', () =>
    apiFetch('/access/memberships', {
      method: 'POST',
      body: JSON.stringify({
        displayName: str(fd, 'displayName'),
        mobile: opt(fd, 'mobile'),
        email: opt(fd, 'email'),
        oneauthSub: opt(fd, 'oneauthSub'),
        personType: str(fd, 'personType') || 'employee',
        roleId: opt(fd, 'roleId'),
      }),
    }),
  );
}

export async function setMembershipStatus(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/memberships', () =>
    apiFetch(`/access/memberships/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: str(fd, 'status') }),
    }),
  );
}

// ---- delegations ---------------------------------------------------------------------------------
export async function createDelegation(fd: FormData) {
  const startsAt = new Date(str(fd, 'startsAt'));
  const endsAt = new Date(str(fd, 'endsAt'));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    back('/access/delegations', 'validation-failed', 'Both dates are required');
  return run('/access/delegations', () =>
    apiFetch('/access/delegations', {
      method: 'POST',
      body: JSON.stringify({
        toUserId: str(fd, 'toUserId'),
        roleId: str(fd, 'roleId'),
        fromUserId: opt(fd, 'fromUserId'),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: str(fd, 'reason'),
      }),
    }),
  );
}

export async function revokeDelegation(fd: FormData) {
  const id = str(fd, 'id');
  return run('/access/delegations', () =>
    apiFetch(`/access/delegations/${id}/revoke`, { method: 'POST', body: '{}' }),
  );
}

// ---- years ---------------------------------------------------------------------------------------
export async function createYear(fd: FormData) {
  return run('/system/years', () =>
    apiFetch('/platform/years', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind'),
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        startDate: str(fd, 'startDate'),
        endDate: str(fd, 'endDate'),
      }),
    }),
  );
}

export async function yearAction(fd: FormData) {
  const kind = str(fd, 'kind');
  const id = str(fd, 'id');
  const action = str(fd, 'action'); // activate | lock | reopen | close
  const body =
    action === 'activate'
      ? undefined
      : action === 'close'
        ? { reason: str(fd, 'reason') || 'closed from admin' }
        : { stage: str(fd, 'stage'), reason: str(fd, 'reason') || `${action} from admin` };
  return run('/system/years', () =>
    apiFetch(`/platform/years/${kind}/${id}/${action}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

// ---- settings ------------------------------------------------------------------------------------
export async function setSetting(fd: FormData) {
  const key = str(fd, 'key');
  const kind = str(fd, 'valueKind');
  const raw = str(fd, 'value');
  let value: unknown = raw;
  if (kind === 'number') value = Number(raw);
  else if (kind === 'boolean') value = raw === 'true';
  else if (kind === 'json') {
    try {
      value = JSON.parse(raw);
    } catch {
      back('/system/settings', 'validation-failed', `${key}: value must be valid JSON`);
    }
  }
  return run('/system/settings', () =>
    apiFetch(`/platform/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, validFrom: opt(fd, 'validFrom') }),
    }),
  );
}

// ---- school --------------------------------------------------------------------------------------
export async function updateSchool(fd: FormData) {
  return run('/system/school', () =>
    apiFetch('/platform/school', {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        shortName: opt(fd, 'shortName') ?? null,
        affiliationNo: opt(fd, 'affiliationNo') ?? null,
        board: str(fd, 'board'),
        timezone: str(fd, 'timezone'),
        locale: str(fd, 'locale'),
      }),
    }),
  );
}

export async function createCampus(fd: FormData) {
  return run('/system/school', () =>
    apiFetch('/platform/school/campuses', {
      method: 'POST',
      body: JSON.stringify({ code: str(fd, 'code').toUpperCase(), name: str(fd, 'name') }),
    }),
  );
}

// ---- comms (Sprint 3) ----------------------------------------------------------------------------
export async function createTemplate(fd: FormData) {
  return run('/comms/templates', () =>
    apiFetch('/comms/templates', {
      method: 'POST',
      body: JSON.stringify({
        code: str(fd, 'code'),
        channel: str(fd, 'channel'),
        name: str(fd, 'name'),
        subject: opt(fd, 'subject'),
        body: String(fd.get('body') ?? ''),
        dltTemplateId: opt(fd, 'dltTemplateId'),
        dltEntityId: opt(fd, 'dltEntityId'),
        senderId: opt(fd, 'senderId'),
      }),
    }),
  );
}

export async function updateTemplate(fd: FormData) {
  const id = str(fd, 'id');
  return run(`/comms/templates/${id}`, () =>
    apiFetch(`/comms/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        subject: opt(fd, 'subject'),
        body: String(fd.get('body') ?? ''),
        dltTemplateId: opt(fd, 'dltTemplateId'),
        dltEntityId: opt(fd, 'dltEntityId'),
        senderId: opt(fd, 'senderId'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function sendMessage(fd: FormData) {
  let variables: Record<string, unknown> = {};
  const raw = str(fd, 'variables');
  if (raw) {
    try {
      variables = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      back(
        '/comms/messages',
        'validation-failed',
        'Variables must be a JSON object such as {"name":"Asha"}',
      );
    }
  }
  return run('/comms/messages', () =>
    apiFetch('/comms/messages', {
      method: 'POST',
      body: JSON.stringify({
        templateId: str(fd, 'templateId'),
        recipientUserId: opt(fd, 'recipientUserId'),
        recipientAddress: opt(fd, 'recipientAddress'),
        variables,
      }),
    }),
  );
}

export async function cancelMessage(fd: FormData) {
  const id = str(fd, 'id');
  return run('/comms/messages', () =>
    apiFetch(`/comms/messages/${id}/cancel`, { method: 'POST', body: '{}' }),
  );
}

// ---- reports and audit (Sprint 3) ----------------------------------------------------------------
export async function createExport(fd: FormData) {
  return run('/reports/exports', () =>
    apiFetch('/reports/exports', {
      method: 'POST',
      body: JSON.stringify({
        dataset: str(fd, 'dataset'),
        format: str(fd, 'format') || 'xlsx',
        title: opt(fd, 'title'),
      }),
    }),
  );
}

export async function exportAudit(fd: FormData) {
  const params: Record<string, string> = {};
  for (const key of ['from', 'to', 'entityType', 'entityId', 'actorUserId', 'action']) {
    const v = opt(fd, key);
    if (v) params[key] = key === 'from' || key === 'to' ? new Date(v).toISOString() : v;
  }
  return run('/reports/exports', () =>
    apiFetch('/platform/audit/export', {
      method: 'POST',
      body: JSON.stringify({ format: str(fd, 'format') || 'xlsx', params }),
    }),
  );
}

export async function retryJob(fd: FormData) {
  const id = str(fd, 'id');
  return run('/system/jobs', () =>
    apiFetch(`/platform/jobs/outbox/${id}/retry`, { method: 'POST', body: '{}' }),
  );
}
