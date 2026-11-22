'use server';
/**
 * School settings (docs/design/95): an area's changes saved together — all or none — from today or a later date.
 * Returns the fresh settings, or the API's words for each setting that is not valid.
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api';
import type { SettingRow } from '@/lib/settings-sections';

export type SaveResult =
  | { ok: true; rows: SettingRow[] }
  | { ok: false; error: string; errors: Array<{ path: string; message: string }> };

export async function saveSettings(
  values: Record<string, unknown>,
  validFrom: string | null,
): Promise<SaveResult> {
  try {
    await apiFetch('/platform/settings', {
      method: 'PUT',
      body: JSON.stringify({ values, ...(validFrom ? { validFrom } : {}) }),
    });
    revalidatePath('/system/settings');
    const rows = (await apiFetch<{ data: SettingRow[] }>('/platform/settings')).data;
    return { ok: true, rows };
  } catch (error) {
    if (error instanceof ApiError) {
      const raw = error.problem.errors as unknown;
      const errors = Array.isArray(raw)
        ? raw
            .map((e) =>
              typeof e === 'object' && e
                ? {
                    path: String((e as { path?: unknown }).path ?? ''),
                    message: String((e as { message?: unknown }).message ?? ''),
                  }
                : { path: '', message: String(e) },
            )
            .filter((e) => e.message)
        : [];
      return {
        ok: false,
        error:
          error.status === 403
            ? 'You can see the settings; changing them needs the right to edit settings.'
            : (error.problem.detail ?? error.problem.title ?? 'Not saved.'),
        errors,
      };
    }
    throw error;
  }
}
