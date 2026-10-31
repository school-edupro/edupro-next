'use server';
/**
 * Exams made easy (docs/design/66): a new exam in steps (or a copy of an earlier one), its details,
 * each class's subjects with their parts and progress card set saved together, the date sheet, and the
 * entry locks one at a time.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { Exam, ExamType } from './types';

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

// ---- a new exam ---------------------------------------------------------------------------------
/**
 * Step 1: the details (or a copy of an earlier exam). A blank code is made from the type and the year
 * (HY-2026, then HY-2026-2 if taken). Then on to the subjects, or for a copy to the date sheet.
 */
export async function createExamGuided(fd: FormData) {
  const fromId = str(fd, 'fromId');
  const here = fromId ? `/exams/new?from=${fromId}` : '/exams/new';
  const typeId = str(fd, 'examTypeId');
  const startsOn = str(fd, 'startsOn') || undefined;
  const given = str(fd, 'code').toUpperCase();
  let base = given;
  if (!base) {
    const types = await apiFetch<{ data: ExamType[] }>('/exams/types').then((r) => r.data);
    const typeCode = types.find((t) => t.id === typeId)?.code ?? 'EXAM';
    base = `${typeCode}-${(startsOn ?? new Date().toISOString()).slice(0, 4)}`
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 17);
  }
  const common = {
    name: str(fd, 'name'),
    startsOn,
    endsOn: str(fd, 'endsOn') || undefined,
    showOnPortal: fd.get('showOnPortal') !== null,
  };
  const scaleId = str(fd, 'gradeScaleId') || null;
  const classes = fd
    .getAll('classId')
    .map(String)
    .filter(Boolean)
    .map((classId) => ({ classId, gradeScaleId: scaleId }));
  let made: Exam | null = null;
  // a made-up code that is taken gets -2, -3 ...; a code the user typed is theirs to change
  for (let n = 1; n <= (given ? 1 : 5) && !made; n += 1) {
    const code = n === 1 ? base : `${base}-${n}`;
    try {
      made = fromId
        ? await apiFetch<Exam>(`/exams/${fromId}/copy`, {
            method: 'POST',
            body: JSON.stringify({ ...common, code, examTypeId: typeId || undefined }),
          })
        : await apiFetch<Exam>('/exams', {
            method: 'POST',
            body: JSON.stringify({ ...common, code, examTypeId: typeId, classes }),
          });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.problem.type === 'conflict' && !given && n < 5) continue;
        back(here, error.problem.type, detailOf(error));
      }
      throw error;
    }
  }
  if (!made) back(here, 'conflict');
  revalidatePath('/exams');
  redirect(`/exams/${made.id}/setup?step=${fromId ? 'dates' : 'subjects'}&new=1`);
}

// ---- details --------------------------------------------------------------------------------------
export async function saveExamDetails(fd: FormData) {
  const id = str(fd, 'id');
  const ticked = new Set(fd.getAll('classId').map(String));
  const classes = fd
    .getAll('rowClassId')
    .map(String)
    .filter((classId) => ticked.has(classId))
    .map((classId) => ({ classId, gradeScaleId: str(fd, `scale-${classId}`) || null }));
  return run(`/exams/${id}/setup?step=details`, () =>
    apiFetch(`/exams/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: str(fd, 'name'),
        startsOn: str(fd, 'startsOn') || null,
        endsOn: str(fd, 'endsOn') || null,
        showOnPortal: fd.get('showOnPortal') !== null,
        status: str(fd, 'status') === 'inactive' ? 'inactive' : 'active',
        areas: fd.getAll('areas').map(String),
        ...(classes.length ? { classes } : {}),
      }),
    }),
  );
}

// ---- a class's subjects, parts and set --------------------------------------------------------------
export interface SubjectInput {
  subjectId: string;
  maxMarks: number;
  passMarks: number | null;
  isElective: boolean;
  gradeScaleId: string | null;
  examOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
}
export interface PartsInput {
  subjectId: string;
  parts: Array<{ id?: string; name: string; subjectId: string | null; maxMarks: number }>;
}

/**
 * Saves a class's subjects, then the parts of each subject whose parts changed (found by subject once
 * the subjects are saved), then the class's indicator / progress card set when it changed.
 */
export async function saveClassSetup(
  examId: string,
  classId: string,
  subjects: SubjectInput[],
  parts: PartsInput[],
  setId: string | null | undefined,
): Promise<Out<null>> {
  const saved = await call<Exam>(`/exams/${examId}/subjects`, 'PUT', { classId, subjects });
  if (!saved.ok) return saved;
  for (const p of parts) {
    const es = saved.data.subjects?.find(
      (s) => s.classId === classId && s.subjectId === p.subjectId,
    );
    if (!es) continue;
    const r = await call(`/exams/${examId}/subjects/${es.id}/parts`, 'PUT', { parts: p.parts });
    if (!r.ok) return r;
  }
  if (setId !== undefined) {
    const r = await call(`/exams/${examId}/indicator-sets`, 'PUT', { classId, setId });
    if (!r.ok) return r;
  }
  revalidatePath(`/exams/${examId}`, 'layout');
  return { ok: true, data: null };
}

/** The date sheet of a class (its subjects with dates and times) and the exam's note under it. */
export async function saveDateSheet(
  examId: string,
  classId: string,
  subjects: SubjectInput[],
  note: string | null | undefined,
): Promise<Out<null>> {
  const saved = await call(`/exams/${examId}/subjects`, 'PUT', { classId, subjects });
  if (!saved.ok) return saved;
  if (note !== undefined) {
    const r = await call(`/exams/${examId}`, 'PATCH', { dateSheetNote: note });
    if (!r.ok) return r;
  }
  revalidatePath(`/exams/${examId}`, 'layout');
  return { ok: true, data: null };
}

// ---- locks -----------------------------------------------------------------------------------------
const AREAS = new Set(['marks', 'indicators', 'remarks', 'attendance', 'health']);

/** One area of one class locked or opened (only that one is sent). */
export async function toggleClassLock(fd: FormData) {
  const examId = str(fd, 'examId');
  const area = str(fd, 'area');
  if (!AREAS.has(area)) back(`/exams/${examId}`, 'validation');
  return run(`/exams/${examId}`, () =>
    apiFetch(`/exams/${examId}/class-locks`, {
      method: 'PUT',
      body: JSON.stringify({ classId: str(fd, 'classId'), [area]: str(fd, 'to') === 'lock' }),
    }),
  );
}

export async function toggleExamLock(fd: FormData) {
  const examId = str(fd, 'examId');
  return run(`/exams/${examId}`, () =>
    apiFetch(`/exams/${examId}`, {
      method: 'PATCH',
      body: JSON.stringify({ marksLocked: str(fd, 'to') === 'lock' }),
    }),
  );
}

// ---- promotion from the exam's results -------------------------------------------------------------
/**
 * The ticked students' decisions recorded in next year's promotion register (People → Promotions applies
 * them); the page stays on the exam's promotion, saying how many were recorded.
 */
export async function recordExamPromotions(fd: FormData) {
  const examId = str(fd, 'examId');
  const classId = str(fd, 'classId');
  const toYearId = str(fd, 'toYearId');
  const here = `/exams/${examId}/promotion?classId=${classId}&toYearId=${toYearId}`;
  const decisions = fd
    .getAll('studentIds')
    .map(String)
    .map((studentId) => ({
      studentId,
      decision: str(fd, `decision:${studentId}`),
      toClassSectionId: str(fd, `section:${studentId}`) || undefined,
    }))
    .filter((d) => d.decision);
  if (!decisions.length) back(here, 'validation-failed', 'Tick the students to record');
  try {
    await apiFetch('/people/promotions', {
      method: 'PUT',
      body: JSON.stringify({ toYearId, decisions }),
    });
  } catch (error) {
    if (error instanceof ApiError) back(here, error.problem.type, detailOf(error));
    throw error;
  }
  back(`${here}&recorded=${String(decisions.length)}`, 'ok');
}
