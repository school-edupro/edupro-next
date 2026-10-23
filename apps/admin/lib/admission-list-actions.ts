'use server';
/** The admissions list (docs/design/39, part 7). */
import { ApiError, apiFetch } from './api';
import type { AdmissionListQuery, AdmissionListResult, AdmissionListView } from './admission-list';
import type { ReportSpec, Result } from './report-builder';

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

export async function admissionListLoad(
  q: AdmissionListQuery,
): Promise<Result<AdmissionListResult>> {
  try {
    const data = await apiFetch<AdmissionListResult>('/admissions/registrations/grid', {
      method: 'POST',
      body: JSON.stringify({ ...q, search: q.search || undefined }),
    });
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

export async function admissionListExport(
  q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
): Promise<Result<{ exportId: string; format: string; spec: ReportSpec }>> {
  try {
    const data = await apiFetch<{ exportId: string; format: string; spec: ReportSpec }>(
      '/admissions/registrations/grid/export',
      {
        method: 'POST',
        body: JSON.stringify({ ...q, search: q.search || undefined }),
      },
    );
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

/** The view this user keeps for the admissions list (never shared). */
export async function admissionListSaveView(v: AdmissionListView): Promise<void> {
  await apiFetch('/me/preferences/admissions.list', {
    method: 'PUT',
    body: JSON.stringify({ value: v }),
  });
}
