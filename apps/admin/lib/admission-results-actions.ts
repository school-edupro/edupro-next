'use server';
/** Test and interview results by part (docs/design/57, part 2). */
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch } from './api';
import type { ResultsRelease, ResultsSheetResult } from './admission-results';

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
type File64 = { filename: string; contentType: string; base64: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const PAGE = '/admissions/results';

function problem(e: unknown): { ok: false; error: string } {
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
const placeOk = (p: { cycleId: string; classId: string; stageId: string }) =>
  okId(p.cycleId) && okId(p.classId) && okId(p.stageId);

/** Rows saved from the screen: every part's marks, absent, remark, a decision (and a reason). */
export async function saveResults(body: {
  cycleId: string;
  classId: string;
  stageId: string;
  rows: Array<{
    applicationId: string;
    marks: Record<string, number | null>;
    absent?: boolean;
    remark?: string | null;
    decision?: 'select' | 'hold' | 'reject' | null;
    reason?: string;
  }>;
}): Promise<Out<{ saved: number; errors: Array<{ applicationId: string; error: string }> }>> {
  if (!placeOk(body)) return { ok: false, error: 'Choose the session, class and stage' };
  try {
    const data = await apiFetch<{
      saved: number;
      errors: Array<{ applicationId: string; error: string }>;
    }>('/admissions/results', { method: 'PUT', body: JSON.stringify(body) });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

/** The class's results sheet, to save in the browser. */
export async function resultsSheet(p: {
  cycleId: string;
  classId: string;
  stageId: string;
  /** a slot's sheet: only its candidates */
  slotId?: string;
}): Promise<Out<File64 & { rows: number }>> {
  if (!placeOk(p) || (p.slotId !== undefined && !okId(p.slotId)))
    return { ok: false, error: 'Choose the session, class and stage' };
  try {
    return {
      ok: true,
      data: await apiFetch<File64 & { rows: number }>(
        `/admissions/results/sheet?${new URLSearchParams(p).toString()}`,
      ),
    };
  } catch (e) {
    return problem(e);
  }
}

/** The filled sheet checked (apply = false) or saved and decided (apply = true). */
export async function resultsSheetUpload(fd: FormData): Promise<Out<ResultsSheetResult>> {
  const file = fd.get('file');
  const apply = fd.get('apply') === '1';
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose the filled sheet' };
  if (!/\.(xlsx|csv)$/i.test(file.name))
    return { ok: false, error: 'The sheet must be an .xlsx or .csv file' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'The sheet is larger than 5 MB' };
  try {
    const data = await apiFetch<ResultsSheetResult>(
      `/admissions/results/sheet${apply ? '?apply=1' : ''}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': /\.csv$/i.test(file.name)
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: Buffer.from(await file.arrayBuffer()),
      },
    );
    if (apply) revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

/** The grid as filtered, as Excel or PDF. */
export async function resultsExport(query: string, format: 'xlsx' | 'pdf'): Promise<Out<File64>> {
  const q = new URLSearchParams(query);
  if (
    !okId(q.get('cycleId') ?? '') ||
    !okId(q.get('classId') ?? '') ||
    !okId(q.get('stageId') ?? '')
  )
    return { ok: false, error: 'Choose the session, class and stage' };
  q.set('format', format);
  try {
    return { ok: true, data: await apiFetch<File64>(`/admissions/results/export?${q.toString()}`) };
  } catch (e) {
    return problem(e);
  }
}

type Place = { cycleId: string; classId: string; stageId: string };

/** The results of a class and stage shown to families from a date and time (now or later). */
export async function setResultsRelease(
  p: Place,
  releaseAt: string,
): Promise<Out<{ release: ResultsRelease | null }>> {
  if (!placeOk(p)) return { ok: false, error: 'Choose the session, class and stage' };
  try {
    const data = await apiFetch<{ release: ResultsRelease | null }>('/admissions/results/release', {
      method: 'PUT',
      body: JSON.stringify({ ...p, releaseAt }),
    });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

/** A release withdrawn before its time. */
export async function withdrawResultsRelease(p: Place): Promise<Out<{ release: null }>> {
  if (!placeOk(p)) return { ok: false, error: 'Choose the session, class and stage' };
  try {
    const data = await apiFetch<{ release: null }>('/admissions/results/release/withdraw', {
      method: 'POST',
      body: JSON.stringify(p),
    });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}

/** The families told the results are out (email, SMS and WhatsApp, sent by the workers). */
export async function tellResults(p: Place): Promise<Out<{ told: number }>> {
  if (!placeOk(p)) return { ok: false, error: 'Choose the session, class and stage' };
  try {
    const data = await apiFetch<{ told: number }>('/admissions/results/release/tell', {
      method: 'POST',
      body: JSON.stringify(p),
    });
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return problem(e);
  }
}
