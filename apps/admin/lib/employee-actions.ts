'use server';
/** The employee master (docs/design/30-employee-master.md): save the profile, onboard, rows, login. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { EmployeeProfile, OnboardResult, SaveEmployeeResult } from './employee';
import type { ProfileValues } from './profile';
import type { EmployeeListQuery, EmployeeListResult, EmployeeListView } from './employee-list';
import type { ReportSpec, Result } from './report-builder';

const BASE = '/people/staff';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

/** The API's [{path, message}] as key → message. */
function fieldErrors(e: ApiError): Record<string, string> {
  const list = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  const out: Record<string, string> = {};
  if (Array.isArray(list)) for (const x of list) if (x.path) out[x.path] = x.message ?? 'not valid';
  return out;
}

export async function saveEmployeeProfile(
  id: string,
  values: ProfileValues,
): Promise<SaveEmployeeResult> {
  if (!okId(id)) return { ok: false, errors: {}, detail: 'Unknown employee' };
  try {
    const profile = await apiFetch<EmployeeProfile>(`${BASE}/${id}/profile`, {
      method: 'PUT',
      body: JSON.stringify({ changes: values }),
    });
    revalidatePath(`/people/employees/${id}`);
    return { ok: true, profile };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        ok: false,
        errors: fieldErrors(error),
        detail: error.problem.detail ?? error.problem.type,
      };
    throw error;
  }
}

export async function onboardEmployee(
  values: ProfileValues,
  createLogin: boolean,
): Promise<OnboardResult> {
  try {
    const r = await apiFetch<{
      id: string;
      code: string;
      login: { made: boolean; reason?: string };
    }>(`${BASE}/onboard`, { method: 'POST', body: JSON.stringify({ values, createLogin }) });
    revalidatePath('/people/employees');
    return { ok: true, ...r };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        ok: false,
        errors: fieldErrors(error),
        detail: error.problem.detail ?? error.problem.type,
      };
    throw error;
  }
}

function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 300))}`,
    );
  throw error;
}

const ROW_FIELDS: Record<string, string[]> = {
  education: ['qualification', 'specialisation', 'institution', 'passingYear', 'score', 'mode'],
  languages: ['language', 'canRead', 'canWrite', 'canSpeak'],
  experience: ['organisation', 'designation', 'fromOn', 'toOn', 'reason'],
  transfers: ['onDate', 'fromPlace', 'toPlace', 'orderNo', 'remarks'],
  remarks: ['onDate', 'remark'],
};
const BOOLS = new Set(['canRead', 'canWrite', 'canSpeak']);

/** Add (no rowId) or change one row of a list on the employee page. */
export async function saveEmployeeRow(fd: FormData) {
  const id = str(fd, 'id');
  const kind = str(fd, 'kind');
  const rowId = str(fd, 'rowId');
  const path = `/people/employees/${id}?tab=${kind === 'remarks' || kind === 'transfers' ? 'history' : kind}`;
  if (!okId(id) || !ROW_FIELDS[kind]) redirect('/people/employees');
  const body: Record<string, unknown> = {};
  for (const k of ROW_FIELDS[kind]!) {
    if (BOOLS.has(k)) body[k] = fd.get(k) === 'on';
    else if (str(fd, k)) body[k] = k === 'passingYear' ? Number(str(fd, k)) : str(fd, k);
  }
  try {
    await apiFetch(`${BASE}/${id}/rows/${kind}${rowId ? `/${rowId}` : ''}`, {
      method: rowId ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    back(path, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`${path}&ok=saved`);
}

export async function removeEmployeeRow(fd: FormData) {
  const id = str(fd, 'id');
  const kind = str(fd, 'kind');
  const rowId = str(fd, 'rowId');
  const path = `/people/employees/${id}?tab=${kind === 'remarks' || kind === 'transfers' ? 'history' : kind}`;
  if (!okId(id) || !okId(rowId) || !ROW_FIELDS[kind]) redirect('/people/employees');
  try {
    await apiFetch(`${BASE}/${id}/rows/${kind}/${rowId}`, { method: 'DELETE' });
  } catch (error) {
    back(path, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`${path}&ok=removed`);
}

export async function createEmployeeLogin(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/people/employees');
  try {
    await apiFetch(`${BASE}/${id}/login`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(`/people/employees/${id}`, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`/people/employees/${id}?ok=login`);
}

// ---- the employee list (part 2) ----

function listError(error: unknown): { ok: false; error: string; errors?: string[] } {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as unknown;
    return {
      ok: false,
      error: error.problem.detail ?? error.problem.type,
      errors: Array.isArray(errs) ? errs.map(String) : undefined,
    };
  }
  throw error;
}

export async function employeeListLoad(q: EmployeeListQuery): Promise<Result<EmployeeListResult>> {
  try {
    const data = await apiFetch<EmployeeListResult>(`${BASE}/grid`, {
      method: 'POST',
      body: JSON.stringify({ ...q, search: q.search || undefined }),
    });
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

export async function employeeListExport(
  q: EmployeeListQuery & { format: 'xlsx' | 'pdf' },
): Promise<Result<{ exportId: string; format: string; spec: ReportSpec }>> {
  try {
    const data = await apiFetch<{ exportId: string; format: string; spec: ReportSpec }>(
      `${BASE}/grid/export`,
      { method: 'POST', body: JSON.stringify({ ...q, search: q.search || undefined }) },
    );
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

/** Saves the employee list view for the signed-in user of this school (never shared). */
export async function employeeListSaveView(v: EmployeeListView): Promise<void> {
  await apiFetch('/me/preferences/employees.list', {
    method: 'PUT',
    body: JSON.stringify({ value: v }),
  });
}

// ---- Excel upload (part 3) ----
export async function employeeBulkValidate(fd: FormData) {
  const mode = str(fd, 'mode') === 'create' ? 'create' : 'update';
  const page = `/people/employees/bulk?mode=${mode}`;
  const file = fd.get('file');
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || (file as File).size === 0)
    redirect(
      `${page}&error=validation-failed&detail=${encodeURIComponent('Choose the filled .xlsx or .csv file')}`,
    );
  const f = file as File;
  const body: Record<string, string> = { mode, fileName: f.name };
  if (/\.csv$/i.test(f.name)) body.csv = await f.text();
  else body.contentBase64 = Buffer.from(await f.arrayBuffer()).toString('base64');
  let out: { id: string } | undefined;
  try {
    out = await apiFetch<{ id: string }>(`${BASE}/bulk/validate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    back(page, error);
  }
  redirect(`${page}&check=${out!.id}`);
}

export async function employeeBulkCommit(fd: FormData) {
  const id = str(fd, 'id');
  const mode = str(fd, 'mode') === 'create' ? 'create' : 'update';
  const page = `/people/employees/bulk?mode=${mode}&check=${id}`;
  if (!okId(id)) redirect(`/people/employees/bulk?mode=${mode}`);
  try {
    await apiFetch(`${BASE}/bulk/${id}/commit`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(page, error);
  }
  revalidatePath('/people/employees');
  redirect(`${page}&ok=applied`);
}

// ---- teaching subjects and employment documents ----
export async function saveEmployeeSubjects(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/people/employees');
  const subjectIds = fd.getAll('subjects').map(String).filter(okId);
  try {
    await apiFetch(`${BASE}/${id}/subjects`, {
      method: 'PUT',
      body: JSON.stringify({ subjectIds }),
    });
  } catch (error) {
    back(`/people/employees/${id}`, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`/people/employees/${id}?ok=saved`);
}

/** Uploads one PDF or image (up to 5 MB) and attaches it as a document of a type. */
export async function uploadEmployeeDocument(fd: FormData) {
  const id = str(fd, 'id');
  const page = `/people/employees/${id}?tab=documents`;
  if (!okId(id)) redirect('/people/employees');
  const file = fd.get('file');
  const fail = (detail: string): never =>
    redirect(`${page}&error=validation-failed&detail=${encodeURIComponent(detail)}`);
  if (!(file instanceof File) || file.size === 0) fail('Choose the file to upload');
  const f = file as File;
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type))
    fail(`${f.name}: attach a PDF or an image (PNG, JPEG, WebP)`);
  if (f.size > 5 * 1024 * 1024) fail(`${f.name}: larger than 5 MB`);
  try {
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: f.name.slice(0, 200),
        contentType: f.type,
        sizeBytes: f.size,
        classification: 'personal',
      }),
    });
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${API_BASE}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': f.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await f.arrayBuffer()),
    });
    if (!put.ok) fail(`${f.name} did not upload`);
    await apiFetch(`${BASE}/${id}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        typeId: str(fd, 'typeId'),
        fileId: reg.file.id,
        number: str(fd, 'number') || undefined,
        issuedOn: str(fd, 'issuedOn') || undefined,
        expiresOn: str(fd, 'expiresOn') || undefined,
        remarks: str(fd, 'remarks') || undefined,
      }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`${page}&ok=uploaded`);
}

export async function verifyEmployeeDocument(fd: FormData) {
  const id = str(fd, 'id');
  const docId = str(fd, 'docId');
  const page = `/people/employees/${id}?tab=documents`;
  if (!okId(id) || !okId(docId)) redirect('/people/employees');
  try {
    await apiFetch(`${BASE}/${id}/documents/${docId}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ verified: str(fd, 'verified') !== 'no' }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`${page}&ok=${str(fd, 'verified') === 'no' ? 'unverified' : 'verified'}`);
}

export async function removeEmployeeDocument(fd: FormData) {
  const id = str(fd, 'id');
  const docId = str(fd, 'docId');
  const page = `/people/employees/${id}?tab=documents`;
  if (!okId(id) || !okId(docId)) redirect('/people/employees');
  try {
    await apiFetch(`${BASE}/${id}/documents/${docId}`, { method: 'DELETE' });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(`/people/employees/${id}`);
  redirect(`${page}&ok=removed`);
}
