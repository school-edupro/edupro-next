'use server';
/** Merit score tables, Recalculate and number series (docs/design/48). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type {
  NumberSeries,
  NumberSeriesRenumberResult,
  NumberSeriesTestResult,
  ScoreOptions,
  ScoreRow,
  ScoreTableName,
} from './admission-scores';

type Out<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; rows?: Array<{ row: number; message: string }> };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const TABLES = new Set<ScoreTableName>(['qualification', 'locality', 'alumni_school']);

function problem(e: unknown): {
  ok: false;
  error: string;
  rows?: Array<{ row: number; message: string }>;
} {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<string | { message?: string }> | undefined;
    const msgs = Array.isArray(list)
      ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
      : [];
    const rows = e.problem.rows as Array<{ row: number; message: string }> | undefined;
    return {
      ok: false,
      error: msgs.length ? msgs.join('. ') : (e.problem.detail ?? e.problem.type),
      rows: Array.isArray(rows) ? rows : undefined,
    };
  }
  throw e;
}

async function call<T>(path: string, method: string, body: unknown, page: string): Promise<Out<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    revalidatePath(page);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

const PAGE = '/admissions/setup/score-tables';

export async function saveScoreRow(
  table: ScoreTableName,
  id: string | null,
  row: Omit<ScoreRow, 'id' | 'className'>,
) {
  if (!TABLES.has(table) || (id && !okId(id))) return { ok: false as const, error: 'Unknown row' };
  return call<{ rows: ScoreRow[] }>(
    id ? `/admissions/score-tables/${table}/${id}` : `/admissions/score-tables/${table}`,
    id ? 'PUT' : 'POST',
    row,
    PAGE,
  );
}

export async function archiveScoreRow(table: ScoreTableName, id: string) {
  if (!TABLES.has(table) || !okId(id)) return { ok: false as const, error: 'Unknown row' };
  return call<{ rows: ScoreRow[] }>(
    `/admissions/score-tables/${table}/${id}`,
    'DELETE',
    undefined,
    PAGE,
  );
}

export async function importScoreSheet(table: ScoreTableName, fileBase64: string) {
  if (!TABLES.has(table)) return { ok: false as const, error: 'Unknown table' };
  return call<{ added: number; changed: number; rows: ScoreRow[] }>(
    `/admissions/score-tables/${table}/import`,
    'POST',
    { fileBase64 },
    PAGE,
  );
}

export async function qualificationsFromList() {
  return call<{ added: number; rows: ScoreRow[] }>(
    '/admissions/score-tables/qualification/from-list',
    'POST',
    {},
    PAGE,
  );
}

/** Localities added to the school's Locality list (the master the table and the form pick from). */
export async function addLocalities(names: string[]) {
  return call<{ added: number; options: ScoreOptions }>(
    '/admissions/score-tables/locality/master',
    'POST',
    { names },
    PAGE,
  );
}

/** The points worked out again for a class (or every class) of a session, except those confirmed. */
export async function recalculatePoints(cycleId: string, classId?: string) {
  if (!okId(cycleId) || (classId && !okId(classId)))
    return { ok: false as const, error: 'Unknown session' };
  return call<{ recalculated: number; changed: number }>(
    `/admissions/cycles/${cycleId}/points/recalculate`,
    'POST',
    classId ? { classId } : {},
    `/admissions/cycles/${cycleId}`,
  );
}

export async function saveNumberSeries(
  id: string | null,
  s: Pick<
    NumberSeries,
    'kind' | 'cycleId' | 'classId' | 'name' | 'conditions' | 'prefix' | 'nextNo' | 'digits'
  >,
) {
  if (id && !okId(id)) return { ok: false as const, error: 'Unknown series' };
  return call<{ series: NumberSeries[] }>(
    id ? `/admissions/number-series/${id}` : '/admissions/number-series',
    id ? 'PUT' : 'POST',
    s,
    '/admissions/setup/numbers',
  );
}

/** Test a series (docs/design/63): which series and number, nothing used. */
export async function testNumberSeries(body: {
  kind: 'registration' | 'admission';
  cycleId: string;
  classId: string;
  answers: Record<string, string>;
}) {
  if (!okId(body.cycleId) || !okId(body.classId))
    return { ok: false as const, error: 'Choose the session and class' };
  return call<NumberSeriesTestResult>(
    '/admissions/number-series/test',
    'POST',
    body,
    '/admissions/setup/numbers',
  );
}

/** Registrations already made given numbers from the series: preview, or apply with a reason. */
export async function renumberNumberSeries(id: string, apply: boolean, reason?: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown series' };
  return call<NumberSeriesRenumberResult>(
    `/admissions/number-series/${id}/renumber`,
    'POST',
    { apply, ...(reason ? { reason } : {}) },
    '/admissions/setup/numbers',
  );
}

export async function archiveNumberSeries(id: string) {
  if (!okId(id)) return { ok: false as const, error: 'Unknown series' };
  return call<{ series: NumberSeries[] }>(
    `/admissions/number-series/${id}`,
    'DELETE',
    undefined,
    '/admissions/setup/numbers',
  );
}
