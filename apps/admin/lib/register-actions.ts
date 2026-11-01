'use server';

import { revalidatePath } from 'next/cache';
import type { RegisterDef } from '@edupro/ui';
import { ApiError, apiFetch } from './api';
import type { BuilderData, MarkScheme } from './mark-schemes';

/**
 * Mark registers (docs/design/68): what the list, the builder and the dialogs ask the API, each
 * answering { ok, data } or { ok: false, error } in the user's words.
 */
type Out<T> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const detailOf = (e: ApiError) => {
  if (typeof e.problem.detail === 'string' && e.problem.detail) return e.problem.detail;
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return Array.isArray(errs)
    ? errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ')
    : undefined;
};
async function call<T>(path: string, method = 'GET', body?: unknown): Promise<Out<T>> {
  try {
    return {
      ok: true,
      data: await apiFetch<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) ?? e.problem.type };
    throw e;
  }
}
const done = <T>(out: Out<T>) => {
  if (out.ok) revalidatePath('/exams/schemes');
  return out;
};

export async function builderData(classIds: string[]): Promise<Out<BuilderData>> {
  const ids = classIds.filter(okId);
  if (!ids.length) return { ok: false, error: 'Choose the classes' };
  return call<BuilderData>(`/exams/schemes/builder?classIds=${ids.join(',')}`);
}

/** another register's settings (to import its codes or grading) */
export async function registerDefOf(id: string): Promise<Out<RegisterDef>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  const out = await call<MarkScheme>(`/exams/schemes/${id}`);
  return out.ok ? { ok: true, data: out.data.def } : out;
}

export async function saveRegister(body: {
  id?: string;
  name: string;
  purpose: 'result' | 'register';
  termCode: string | null;
  classIds: string[];
  def: RegisterDef;
}): Promise<Out<MarkScheme>> {
  const { id, ...rest } = body;
  const payload = { ...rest, termCode: rest.purpose === 'result' ? rest.termCode : undefined };
  if (id && !okId(id)) return { ok: false, error: 'Unknown register' };
  return done(
    id
      ? await call<MarkScheme>(`/exams/schemes/${id}`, 'PUT', {
          ...payload,
          termCode: payload.termCode ?? null,
        })
      : await call<MarkScheme>('/exams/schemes', 'POST', payload),
  );
}

export type RegisterStep = 'lock' | 'unlock' | 'compute' | 'delete';
export async function registerStep(
  id: string,
  step: RegisterStep,
): Promise<Out<{ counts?: Record<string, number> }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(
    step === 'delete'
      ? await call(`/exams/schemes/${id}`, 'DELETE')
      : await call(`/exams/schemes/${id}/${step}`, 'POST'),
  );
}

export async function copyRegister(
  id: string,
  name: string,
  classIds: string[],
): Promise<Out<MarkScheme & { dropped: string[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(
    await call(`/exams/schemes/${id}/copy`, 'POST', { name, classIds: classIds.filter(okId) }),
  );
}

export async function deletedRegisters(): Promise<
  Out<{
    data: Array<{
      id: string;
      name: string;
      version: number;
      classes: string[];
      deletedAt: string;
      deletedBy: string | null;
    }>;
  }>
> {
  return call('/exams/schemes/deleted');
}

export async function restoreRegister(id: string, name?: string): Promise<Out<MarkScheme>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`/exams/schemes/${id}/restore`, 'POST', name ? { name } : {}));
}

export async function registerVersions(id: string): Promise<
  Out<{
    name: string;
    data: Array<{
      id: string;
      version: number;
      status: string;
      updatedAt: string;
      updatedBy: string | null;
      lockedBy: string | null;
      results: number;
    }>;
  }>
> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return call(`/exams/schemes/${id}/versions`);
}

export async function restoreVersion(id: string, name: string): Promise<Out<MarkScheme>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`/exams/schemes/${id}/restore-version`, 'POST', { name }));
}

export interface AccessRow {
  userId: string;
  name: string;
  designation: string | null;
  run: boolean;
  edit: boolean;
  delete: boolean;
  assign: boolean;
}
export async function registerAccess(
  id: string,
): Promise<Out<{ name: string; mine: Record<string, boolean>; data: AccessRow[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return call(`/exams/schemes/${id}/access`);
}
export async function saveRegisterAccess(
  id: string,
  rows: Array<Pick<AccessRow, 'userId' | 'run' | 'edit' | 'delete' | 'assign'>>,
): Promise<Out<{ data: AccessRow[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`/exams/schemes/${id}/access`, 'PUT', { rows }));
}
export async function registerStaff(): Promise<
  Out<{
    data: Array<{
      userId: string;
      name: string;
      designation: string | null;
      department: string | null;
    }>;
  }>
> {
  return call('/exams/schemes/staff');
}
export async function rightsReport(): Promise<
  Out<{ data: Array<AccessRow & { chainId: string; register: string }> }>
> {
  return call('/exams/schemes/rights');
}
export async function removeRights(
  pairs: Array<{ chainId: string; userId: string }>,
): Promise<Out<{ removed: number }>> {
  return done(await call('/exams/schemes/rights/remove', 'POST', { pairs }));
}
