'use server';

import { revalidatePath } from 'next/cache';
import type { RegisterDef } from '@edupro/ui';
import { ApiError, apiFetch } from './api';
import type { GradeRegisterDef } from '@edupro/ui';
import type { GradeBuilderData, GradeRegister } from './grade-registers';
import type { BuilderData, MarkScheme } from './mark-schemes';

/**
 * Mark registers (docs/design/68) and grade registers (docs/design/69): what the list, the builders and
 * the dialogs ask the API, each answering { ok, data } or { ok: false, error } in the user's words. The
 * list's actions take the kind of register (mark by default).
 */
export type RegisterKind = 'mark' | 'grade';
const BASE: Record<RegisterKind, string> = {
  mark: '/exams/schemes',
  grade: '/exams/grade-registers',
};
const PAGE: Record<RegisterKind, string> = {
  mark: '/exams/schemes',
  grade: '/exams/grade-registers',
};
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
const done = <T>(out: Out<T>, kind: RegisterKind = 'mark') => {
  if (out.ok) revalidatePath(PAGE[kind]);
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
  kind: RegisterKind = 'mark',
): Promise<Out<{ counts?: Record<string, number> }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  if (kind === 'grade' && step === 'compute') return { ok: false, error: 'Unknown step' };
  return done(
    step === 'delete'
      ? await call(`${BASE[kind]}/${id}`, 'DELETE')
      : await call(`${BASE[kind]}/${id}/${step}`, 'POST'),
    kind,
  );
}

export async function copyRegister(
  id: string,
  name: string,
  classIds: string[],
  kind: RegisterKind = 'mark',
): Promise<Out<{ name: string; dropped: string[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(
    await call(`${BASE[kind]}/${id}/copy`, 'POST', { name, classIds: classIds.filter(okId) }),
    kind,
  );
}

export async function deletedRegisters(kind: RegisterKind = 'mark'): Promise<
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
  return call(`${BASE[kind]}/deleted`);
}

export async function restoreRegister(
  id: string,
  name?: string,
  kind: RegisterKind = 'mark',
): Promise<Out<{ name: string }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`${BASE[kind]}/${id}/restore`, 'POST', name ? { name } : {}), kind);
}

export async function registerVersions(
  id: string,
  kind: RegisterKind = 'mark',
): Promise<
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
  return call(`${BASE[kind]}/${id}/versions`);
}

export async function restoreVersion(
  id: string,
  name: string,
  kind: RegisterKind = 'mark',
): Promise<Out<{ name: string }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`${BASE[kind]}/${id}/restore-version`, 'POST', { name }), kind);
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
  kind: RegisterKind = 'mark',
): Promise<Out<{ name: string; mine: Record<string, boolean>; data: AccessRow[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return call(`${BASE[kind]}/${id}/access`);
}
export async function saveRegisterAccess(
  id: string,
  rows: Array<Pick<AccessRow, 'userId' | 'run' | 'edit' | 'delete' | 'assign'>>,
  kind: RegisterKind = 'mark',
): Promise<Out<{ data: AccessRow[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`${BASE[kind]}/${id}/access`, 'PUT', { rows }), kind);
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
export async function rightsReport(
  kind: RegisterKind = 'mark',
): Promise<Out<{ data: Array<AccessRow & { chainId: string; register: string }> }>> {
  return call(`${BASE[kind]}/rights`);
}
export async function removeRights(
  pairs: Array<{ chainId: string; userId: string }>,
  kind: RegisterKind = 'mark',
): Promise<Out<{ removed: number }>> {
  return done(await call(`${BASE[kind]}/rights/remove`, 'POST', { pairs }), kind);
}

// ---- grade registers (docs/design/69) ---------------------------------------------------------------
export async function gradeBuilderData(
  classIds: string[],
  examIds: string[],
): Promise<Out<GradeBuilderData>> {
  const c = classIds.filter(okId);
  const e = examIds.filter(okId);
  const q = new URLSearchParams();
  if (c.length) q.set('classIds', c.join(','));
  if (e.length) q.set('examIds', e.join(','));
  return call<GradeBuilderData>(`/exams/grade-registers/builder?${q.toString()}`);
}

export async function saveGradeRegister(body: {
  id?: string;
  name: string;
  classIds: string[];
  def: GradeRegisterDef;
}): Promise<Out<GradeRegister>> {
  const { id, ...payload } = body;
  if (id && !okId(id)) return { ok: false, error: 'Unknown register' };
  return done(
    id
      ? await call<GradeRegister>(`/exams/grade-registers/${id}`, 'PUT', payload)
      : await call<GradeRegister>('/exams/grade-registers', 'POST', payload),
    'grade',
  );
}

export async function setGradeAccessType(
  id: string,
  type: 'all' | 'mapping',
): Promise<Out<GradeRegister>> {
  if (!okId(id)) return { ok: false, error: 'Unknown register' };
  return done(await call(`/exams/grade-registers/${id}/access-type`, 'PUT', { type }), 'grade');
}
