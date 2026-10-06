'use server';
/** Teacher assignments: one teacher on many classes and subjects in one save, and the Excel upload. */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';

export type AssignResult =
  | {
      ok: true;
      text: string;
      skipped: Array<{ what: string; why: string }>;
      errors: Array<{ row: number; message: string }>;
    }
  | { ok: false; error: string };

const said = (error: unknown): string => {
  if (!(error instanceof ApiError)) throw error;
  const errs = error.problem.errors as Array<{ message?: string }> | undefined;
  return (
    (Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : '') ||
    error.problem.detail ||
    error.problem.type
  );
};

export async function bulkTeacherAssignments(input: {
  employeeId: string;
  kind: string;
  classSectionIds: string[];
  subjectIds: string[];
  isActual: boolean;
}): Promise<AssignResult> {
  try {
    const r = await apiFetch<{ created: number; skipped: Array<{ what: string; why: string }> }>(
      '/academics/teacher-assignments/bulk',
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath('/academics/teacher-assignments');
    return {
      ok: true,
      text: `${String(r.created)} assignment${r.created === 1 ? '' : 's'} saved${r.skipped.length ? `, ${String(r.skipped.length)} left out` : ''}.`,
      skipped: r.skipped,
      errors: [],
    };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}

export async function importTeacherAssignments(fileBase64: string): Promise<AssignResult> {
  try {
    const r = await apiFetch<{
      created: number;
      skipped: Array<{ what: string; why: string }>;
      errors: Array<{ row: number; message: string }>;
    }>('/academics/teacher-assignments/import', {
      method: 'POST',
      body: JSON.stringify({ fileBase64 }),
    });
    if (r.errors.length)
      return {
        ok: true,
        text: 'Nothing was saved: correct these rows in the sheet and upload it again.',
        skipped: [],
        errors: r.errors,
      };
    revalidatePath('/academics/teacher-assignments');
    return {
      ok: true,
      text: `${String(r.created)} assignment${r.created === 1 ? '' : 's'} saved${r.skipped.length ? `, ${String(r.skipped.length)} left out` : ''}.`,
      skipped: r.skipped,
      errors: [],
    };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}
