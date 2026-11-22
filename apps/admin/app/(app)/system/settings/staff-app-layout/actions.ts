'use server';
/**
 * Staff app layout (0413, docs/design/94): the editor's saves. Each returns the fresh set-up or the API's words for
 * what is wrong.
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api';
import type { StaffLayout, StaffLayoutSetup } from '@/lib/staff-layout';

const PAGE = '/system/settings/staff-app-layout';

type Result = { ok: true; data: StaffLayoutSetup } | { ok: false; error: string };

async function result(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath(PAGE);
    return { ok: true, data: await apiFetch<StaffLayoutSetup>('/platform/staff-app-layout') };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as unknown;
      const list = Array.isArray(errs)
        ? errs
            .map((e) =>
              typeof e === 'string' ? e : ((e as { message?: string } | null)?.message ?? ''),
            )
            .filter(Boolean)
        : [];
      return {
        ok: false,
        error: list.length ? list.join(' ') : (error.problem.detail ?? error.problem.type),
      };
    }
    throw error;
  }
}

/** The draft saved; staff get nothing until it is published. */
export async function saveStaffLayoutDraft(layout: StaffLayout): Promise<Result> {
  return result(() =>
    apiFetch('/platform/staff-app-layout', {
      method: 'PUT',
      body: JSON.stringify({ tabs: layout.tabs, shortcuts: layout.shortcuts, cards: layout.cards }),
    }),
  );
}

/** The draft becomes what staff get. */
export async function publishStaffLayout(): Promise<Result> {
  return result(() => apiFetch('/platform/staff-app-layout/publish', { method: 'POST' }));
}

/** The draft goes back to what staff have now. */
export async function discardStaffLayout(): Promise<Result> {
  return result(() => apiFetch('/platform/staff-app-layout/discard', { method: 'POST' }));
}
