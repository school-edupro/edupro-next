'use server';
/** The admissions list (docs/design/39, part 7). */
import { ApiError, apiFetch } from './api';
import type {
  AdmissionListQuery,
  AdmissionListResult,
  AdmissionListScope,
  AdmissionListView,
} from './admission-list';
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

async function load(
  q: AdmissionListQuery,
  scope: AdmissionListScope,
): Promise<Result<AdmissionListResult>> {
  try {
    const data = await apiFetch<AdmissionListResult>('/admissions/registrations/grid', {
      method: 'POST',
      body: JSON.stringify({ ...q, scope, search: q.search || undefined }),
    });
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

async function exportFile(
  q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
  scope: AdmissionListScope,
): Promise<Result<{ exportId: string; format: string; spec: ReportSpec }>> {
  try {
    const data = await apiFetch<{ exportId: string; format: string; spec: ReportSpec }>(
      '/admissions/registrations/grid/export',
      {
        method: 'POST',
        body: JSON.stringify({ ...q, scope, search: q.search || undefined }),
      },
    );
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

/** A ready-made admission report for the view, made at once (docs/design/52, part 1). */
async function ready(
  key: string,
  q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
  scope: AdmissionListScope,
): Promise<Result<{ filename: string; contentType: string; base64: string }>> {
  if (!/^[a-z_]{3,30}$/.test(key)) return { ok: false, error: 'Unknown report' };
  try {
    const data = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/admissions/registrations/grid/ready-made/${key}`,
      {
        method: 'POST',
        body: JSON.stringify({ ...q, scope, search: q.search || undefined }),
      },
    );
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}
export async function admissionListReady(
  key: string,
  q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
) {
  return ready(key, q, 'list');
}

export async function admissionListLoad(q: AdmissionListQuery) {
  return load(q, 'list');
}
export async function admissionListExport(q: AdmissionListQuery & { format: 'xlsx' | 'pdf' }) {
  return exportFile(q, 'list');
}

/** The view this user keeps for the admissions list (never shared). */
export async function admissionListSaveView(v: AdmissionListView): Promise<void> {
  await apiFetch('/me/preferences/admissions.list', {
    method: 'PUT',
    body: JSON.stringify({ value: v }),
  });
}
