'use server';
/**
 * Indicators and the Holistic Progress Card (docs/design/65, part 5): indicator sets in three levels,
 * the NCERT foundational set and the HPC card, a class's set in an exam, levels and observations per
 * section, the child's / parent's / teacher's words and portfolio photos.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

function back(path: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(path, 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 200));
  url.searchParams.set('r', Date.now().toString(36));
  revalidatePath(url.pathname);
  redirect(`${url.pathname}${url.search}`);
}
const detailOf = (e: ApiError) => {
  if (typeof e.problem.detail === 'string' && e.problem.detail) return e.problem.detail;
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return Array.isArray(errs)
    ? errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ')
    : undefined;
};
async function run(path: string, fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, detailOf(error));
    throw error;
  }
  back(path, 'ok');
}
type Out<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(path: string, method: string, body?: unknown): Promise<Out<T>> {
  try {
    return {
      ok: true,
      data: await apiFetch<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) ?? e.problem.type };
    throw e;
  }
}

// ---- sets ---------------------------------------------------------------------------------------
export async function installHpcSet() {
  return run('/exams/indicators', () => apiFetch('/exams/indicator-sets/hpc', { method: 'POST' }));
}

export async function installHpcCard() {
  return run('/exams/indicators', () =>
    apiFetch('/exams/report-cards/templates/hpc', { method: 'POST' }),
  );
}

export interface SetInput {
  code: string;
  name: string;
  kind: 'indicators' | 'hpc';
  grades: string[];
  levelWords: Record<string, string>;
  indicators: Array<{
    code: string;
    name: string;
    area?: string;
    sortOrder: number;
    parentCode: string | null;
    kind: 'level' | 'text';
    description: string | null;
    descriptors: Record<string, string>;
  }>;
}

export async function saveIndicatorSet(input: SetInput) {
  const out = await call<{ id: string }>('/exams/indicator-sets', 'PUT', input);
  if (out.ok) revalidatePath('/exams/indicators');
  return out;
}

/** The set a class uses in an exam (none: the class has no indicators in it). */
export async function assignIndicatorSet(fd: FormData) {
  const examId = str(fd, 'examId');
  const classId = str(fd, 'classId');
  const setId = str(fd, 'setId');
  return run(`/exams/${examId}?classId=${classId}`, () =>
    apiFetch(`/exams/${examId}/indicator-sets`, {
      method: 'PUT',
      body: JSON.stringify({ classId, setId: setId || null }),
    }),
  );
}

// ---- entry --------------------------------------------------------------------------------------
/** One area of a section: a level (or an observation) per student and item; an empty cell is removed. */
export async function saveIndicatorEntries(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/indicators`;
  const items = fd.getAll('item').map(String);
  const rows: Array<{
    studentId: string;
    indicatorId: string;
    grade: string | null;
    note: string | null;
  }> = [];
  for (const studentId of fd.getAll('studentId').map(String))
    for (const indicatorId of items) {
      const k = `${studentId}-${indicatorId}`;
      if (!fd.has(`l-${k}`) && !fd.has(`n-${k}`)) continue;
      rows.push({
        studentId,
        indicatorId,
        grade: str(fd, `l-${k}`) || null,
        note: str(fd, `n-${k}`) || null,
      });
    }
  if (!rows.length) back(backTo, 'validation-failed', 'Nothing to save');
  return run(backTo, () =>
    apiFetch(`/exams/${examId}/indicators`, {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), rows }),
    }),
  );
}

/** A child's words, the parent's (unless they wrote it in the app) and the teacher's. */
export async function saveHpcFeedback(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/indicators`;
  const studentId = str(fd, 'studentId');
  const rows = (['self', 'parent', 'teacher'] as const)
    .filter((k) => fd.has(k))
    .map((kind) => ({ studentId, kind, text: str(fd, kind) || null }));
  return run(backTo, () =>
    apiFetch(`/exams/${examId}/hpc-feedback`, {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: str(fd, 'classSectionId'), rows }),
    }),
  );
}

export async function addPortfolioPhoto(input: {
  examId: string;
  classSectionId: string;
  studentId: string;
  caption: string;
  indicatorId: string | null;
  contentType: 'image/png' | 'image/jpeg';
  base64: string;
}) {
  const out = await call<{ id: string }>(`/exams/${input.examId}/portfolio`, 'POST', {
    classSectionId: input.classSectionId,
    studentId: input.studentId,
    caption: input.caption || undefined,
    indicatorId: input.indicatorId,
    image: { contentType: input.contentType, base64: input.base64 },
  });
  if (out.ok) revalidatePath(`/exams/${input.examId}/indicators`);
  return out;
}

export async function removePortfolioPhoto(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/indicators`;
  return run(backTo, () =>
    apiFetch(`/exams/${examId}/portfolio/${str(fd, 'itemId')}`, { method: 'DELETE' }),
  );
}
