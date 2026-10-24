'use server';
/** Detail corrections (docs/design/37, part 1) and the office's correction of an application. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

type Out<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; errors?: Record<string, string> };
const okId = (id: string) => /^\d{1,18}$/.test(id);

function problem(e: unknown): { ok: false; error: string; errors?: Record<string, string> } {
  if (e instanceof ApiError) {
    const errors = e.problem.errors as Record<string, string> | undefined;
    return {
      ok: false,
      error: e.problem.detail ?? e.problem.type,
      ...(errors && !Array.isArray(errors) ? { errors } : {}),
    };
  }
  throw e;
}

export async function requestCorrection(
  studentId: string,
  values: Record<string, string | null>,
  reason: string,
): Promise<Out> {
  if (!okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    const data = await apiFetch(`/people/students/${studentId}/corrections`, {
      method: 'POST',
      body: JSON.stringify({ values, reason }),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function withdrawCorrection(studentId: string, id: string): Promise<Out> {
  if (!okId(studentId) || !okId(id)) return { ok: false, error: 'Unknown correction' };
  try {
    const data = await apiFetch(`/people/students/${studentId}/corrections/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function correctApplication(
  id: string,
  answers: Record<string, unknown>,
  reason: string,
): Promise<Out<{ changed: Array<{ key: string; label: string }> }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown registration' };
  try {
    const data = await apiFetch<{ changed: Array<{ key: string; label: string }> }>(
      `/admissions/registrations/${id}/correct`,
      { method: 'POST', body: JSON.stringify({ answers, reason }) },
    );
    revalidatePath(`/admissions/registrations/${id}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export interface ClassOutcome {
  from: { sectionId: string; label: string };
  to: { sectionId: string; label: string };
  rollNo: number;
  effectiveFrom: string;
  fee: {
    lines: Array<{
      period: string;
      head: string;
      ledger: string;
      before: number | null;
      after: number | null;
      paid: number;
    }>;
    before: { charged: number; paid: number; due: number };
    after: { charged: number; paid: number; due: number };
    freed: number;
    setAgainst: number;
    advance: number;
    kept: Array<{ period: string; head: string; why: string }>;
  };
}

export async function previewClassCorrection(
  studentId: string,
  body: { toSectionId: string; effectiveFrom?: string },
): Promise<Out<ClassOutcome>> {
  if (!okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    const data = await apiFetch<ClassOutcome>(
      `/people/students/${studentId}/class-corrections/preview`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function requestClassCorrection(
  studentId: string,
  body: { toSectionId: string; effectiveFrom?: string; reason: string },
): Promise<Out> {
  if (!okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    const data = await apiFetch(`/people/students/${studentId}/class-corrections`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function withdrawClassCorrection(studentId: string, id: string): Promise<Out> {
  if (!okId(studentId) || !okId(id)) return { ok: false, error: 'Unknown correction' };
  try {
    const data = await apiFetch(`/people/students/${studentId}/class-corrections/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}
