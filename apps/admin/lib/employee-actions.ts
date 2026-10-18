'use server';
/** The employee master (docs/design/30-employee-master.md): save the profile, onboard, rows, login. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { EmployeeProfile, OnboardResult, SaveEmployeeResult } from './employee';
import type { ProfileValues } from './profile';

const BASE = '/people/staff';
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
