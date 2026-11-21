'use server';
/**
 * Family app layout (0407, docs/design/90): the editor's saves. Each returns the fresh set-up (both audiences) or the
 * API's words for what is wrong.
 */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from '@/lib/api';
import type { FamilyAudience, FamilyLayout, FamilyLayoutSetup } from '@/lib/family-layout';

const PAGE = '/system/settings/family-app-layout';

type Result = { ok: true; data: FamilyLayoutSetup } | { ok: false; error: string };

const audienceOk = (a: string): a is FamilyAudience => a === 'student' || a === 'parent';

async function result(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    revalidatePath(PAGE);
    return { ok: true, data: await apiFetch<FamilyLayoutSetup>('/platform/family-app-layout') };
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

/** The draft saved; families get nothing until it is published. */
export async function saveLayoutDraft(audience: string, layout: FamilyLayout): Promise<Result> {
  if (!audienceOk(audience)) return { ok: false, error: 'Students or parents only.' };
  return result(() =>
    apiFetch(`/platform/family-app-layout/${audience}`, {
      method: 'PUT',
      body: JSON.stringify({
        tabs: layout.tabs,
        shortcuts: layout.shortcuts,
        cards: layout.cards,
        academics: layout.academics,
        // the side menu as edited (an empty name: the standard one)
        ...(layout.menu
          ? {
              menu: layout.menu.map((g) => ({
                key: g.key,
                label: g.label?.trim() ? g.label : null,
                labelHi: g.labelHi?.trim() ? g.labelHi : null,
                items: g.items,
              })),
            }
          : {}),
      }),
    }),
  );
}

/** The draft becomes what families get on their next refresh. */
export async function publishLayout(audience: string): Promise<Result> {
  if (!audienceOk(audience)) return { ok: false, error: 'Students or parents only.' };
  return result(() =>
    apiFetch(`/platform/family-app-layout/${audience}/publish`, { method: 'POST', body: '{}' }),
  );
}

/** The draft goes back to what families have now. */
export async function discardLayout(audience: string): Promise<Result> {
  if (!audienceOk(audience)) return { ok: false, error: 'Students or parents only.' };
  return result(() =>
    apiFetch(`/platform/family-app-layout/${audience}/discard`, { method: 'POST', body: '{}' }),
  );
}
