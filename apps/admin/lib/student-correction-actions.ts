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

export interface MergeSide {
  id: string;
  name: string;
  admissionNo: string;
  dob: string | null;
  father: string | null;
  mother: string | null;
  classSection: string | null;
  admittedOn: string | null;
  due: number;
}
export interface MergeOutcome {
  keep: MergeSide;
  duplicate: MergeSide;
  moved: Array<{ area: string; label: string; count: number }>;
  clashes: Array<{ area: string; label: string; rule: string; count: number }>;
  fee: { receipts: number; dueAfter: number; freed: number; setAgainst: number; advance: number };
  logins: 'moved' | 'stopped' | 'none';
}
export interface MergePreview {
  blockers: string[];
  keep: MergeSide | null;
  duplicate: MergeSide | null;
  outcome: MergeOutcome | null;
}

/** Other records that may be the same child: by admission number or name. */
export async function findStudents(
  q: string,
): Promise<Array<{ id: string; name: string; admissionNo: string; section: string | null }>> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const r = await apiFetch<{
    data: Array<{
      id: string;
      displayName: string;
      admissionNo: string;
      enrolment: { classCode: string; section: string } | null;
    }>;
  }>(`/people/students?q=${encodeURIComponent(term)}&size=10`).catch(() => ({ data: [] }));
  return r.data.map((s) => ({
    id: s.id,
    name: s.displayName,
    admissionNo: s.admissionNo,
    section: s.enrolment ? `${s.enrolment.classCode}-${s.enrolment.section}` : null,
  }));
}

export async function previewMerge(body: {
  keepId: string;
  duplicateId: string;
}): Promise<Out<MergePreview>> {
  if (!okId(body.keepId) || !okId(body.duplicateId))
    return { ok: false, error: 'Choose the two records' };
  try {
    const data = await apiFetch<MergePreview>('/people/student-merges/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function requestMerge(body: {
  keepId: string;
  duplicateId: string;
  reason: string;
}): Promise<Out> {
  if (!okId(body.keepId) || !okId(body.duplicateId))
    return { ok: false, error: 'Choose the two records' };
  try {
    const data = await apiFetch('/people/student-merges', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath(`/people/students/${body.keepId}`);
    revalidatePath(`/people/students/${body.duplicateId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function withdrawMerge(id: string, studentId: string): Promise<Out> {
  if (!okId(id)) return { ok: false, error: 'Unknown merge' };
  try {
    const data = await apiFetch(`/people/student-merges/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export interface CancelOutcome {
  student: {
    id: string;
    name: string;
    admissionNo: string;
    classSection: string;
    admittedOn: string | null;
  };
  settlement: 'refund' | 'retain';
  fee: {
    before: { charged: number; paid: number; due: number };
    after: { charged: number; paid: number; due: number };
    cancelled: number;
    refunds: number;
    refundTotal: number;
    retained: number;
  };
  admissionFee: { paid: number; deduction: number; refund: number } | null;
  logins: { student: boolean; parents: number };
  hostelBed: boolean;
}

export async function previewAdmissionCancel(
  studentId: string,
  settlement: 'refund' | 'retain',
): Promise<Out<CancelOutcome>> {
  if (!okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    const data = await apiFetch<CancelOutcome>(
      `/people/students/${studentId}/admission-cancellations/preview`,
      { method: 'POST', body: JSON.stringify({ settlement }) },
    );
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function requestAdmissionCancel(
  studentId: string,
  body: { settlement: 'refund' | 'retain'; reason: string },
): Promise<Out> {
  if (!okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    const data = await apiFetch(`/people/students/${studentId}/admission-cancellations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

export async function withdrawAdmissionCancel(studentId: string, id: string): Promise<Out> {
  if (!okId(studentId) || !okId(id)) return { ok: false, error: 'Unknown request' };
  try {
    const data = await apiFetch(
      `/people/students/${studentId}/admission-cancellations/${id}/withdraw`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    revalidatePath(`/people/students/${studentId}`);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}
