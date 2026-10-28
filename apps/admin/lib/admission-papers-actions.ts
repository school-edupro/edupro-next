'use server';
/** Test and interview papers by class (docs/design/57, part 1). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type { Paper, PaperItemsView } from './admission-papers';

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const PAGE = '/admissions/setup/papers';

async function call<T>(path: string, method: string, body: unknown): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, { method, body: JSON.stringify(body) });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError) {
      const list = e.problem.errors as Array<string | { message?: string }> | undefined;
      const msgs = Array.isArray(list)
        ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
        : [];
      return {
        ok: false,
        error: msgs.length ? msgs.join('. ') : String(e.problem.detail ?? e.problem.type),
      };
    }
    throw e;
  }
}

/** A class's paper saved: its parts in order and the minimum total % (no parts: no paper). */
export async function savePaper(
  stageId: string,
  classId: string,
  body: {
    minPercent: number | null;
    parts: Array<{ id?: string; itemId: string; maxMarks: number; passMarks: number | null }>;
  },
) {
  if (!okId(stageId) || !okId(classId)) return { ok: false as const, error: 'Unknown class' };
  return call<{ paper: Paper | null }>(
    `/admissions/stages/${stageId}/papers/${classId}`,
    'PUT',
    body,
  );
}

/** A class's paper copied to other classes (their parts replaced). */
export async function copyPaper(stageId: string, fromClassId: string, toClassIds: string[]) {
  if (!okId(stageId) || !okId(fromClassId) || !toClassIds.every(okId))
    return { ok: false as const, error: 'Unknown class' };
  return call<{ copied: number }>(`/admissions/stages/${stageId}/papers/copy`, 'POST', {
    fromClassId,
    toClassIds,
  });
}

/** The school's test subjects and interview parameters saved (an entry in use is switched off). */
export async function savePaperItems(
  items: Array<{
    id?: string;
    name: string;
    kind: 'test' | 'interview' | 'both';
    maxMarks: number | null;
    status: 'active' | 'inactive';
  }>,
) {
  return call<PaperItemsView>('/admissions/paper-items', 'PUT', { items });
}

/** The school's scholastic subjects not on the list added to it. */
export async function importPaperSubjects() {
  return call<PaperItemsView & { added: number }>(
    '/admissions/paper-items/import-subjects',
    'POST',
    {},
  );
}
