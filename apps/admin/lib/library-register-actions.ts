'use server';
import { ApiError, apiFetch } from './api';
import {
  PREF,
  type RegisterLevel,
  type RegisterQuery,
  type RegisterResult,
  type RegisterView,
} from './library-register';
import type { Result } from './report-builder';

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
const body = (q: RegisterQuery) => ({ ...q, search: q.search || undefined });

/** A page of the copies or the titles for the view on screen. */
export async function registerLoad(
  level: RegisterLevel,
  q: RegisterQuery,
): Promise<Result<RegisterResult>> {
  try {
    const data = await apiFetch<RegisterResult>(`/library/register/${level}`, {
      method: 'POST',
      body: JSON.stringify(body(q)),
    });
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

/** The view on screen as Excel or PDF, made at once. */
export async function registerDownload(
  level: RegisterLevel,
  q: RegisterQuery & { format: 'xlsx' | 'pdf' },
): Promise<Result<{ filename: string; contentType: string; base64: string }>> {
  try {
    const data = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/library/register/${level}/export`,
      {
        method: 'POST',
        body: JSON.stringify({
          columns: q.columns,
          filters: q.filters,
          sort: q.sort,
          search: q.search || undefined,
          status: q.status,
          format: q.format,
        }),
      },
    );
    return { ok: true, data };
  } catch (error) {
    return listError(error);
  }
}

/** Keeps the view for the signed-in user of this school (never shared). */
export async function registerSaveView(level: RegisterLevel, v: RegisterView): Promise<void> {
  await apiFetch(`/me/preferences/${PREF[level]}`, {
    method: 'PUT',
    body: JSON.stringify({ value: v }),
  });
}
