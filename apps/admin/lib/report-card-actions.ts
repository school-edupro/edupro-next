'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { UploadPreview } from './exam-entry-actions';

/**
 * The report-card release workspace (docs/design/65): make a release, its set-up, the PDFs, holds and
 * the steps to the families; each returns to the tab it came from with what happened.
 */
const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

function back(path: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(path, 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 200));
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
async function run(path: string, fn: () => Promise<unknown>, done?: string): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, detailOf(error));
    throw error;
  }
  back(path, 'ok', done);
}
/** the workspace tab to come back to (only this app's own release pages) */
const backTo = (fd: FormData, id: string) => {
  const b = str(fd, 'back');
  // the release's own tabs, or the list's class view (publish / revoke a class from there)
  return b.startsWith(`/exams/report-cards/${id}?`) ||
    /^\/exams\/report-cards\?view=class(&|$)/.test(b)
    ? b
    : `/exams/report-cards/${id}`;
};

export async function createRelease(fd: FormData) {
  let made: { id: string } | undefined;
  try {
    made = await apiFetch<{ id: string }>('/exams/report-cards/releases', {
      method: 'POST',
      body: JSON.stringify({
        kind: ['exam', 'term', 'annual'].includes(str(fd, 'kind')) ? str(fd, 'kind') : 'term',
        termCode: str(fd, 'termCode').toUpperCase(),
        name: str(fd, 'name'),
        examIds: fd.getAll('examIds').map(String).filter(okId),
        templates: {},
        hideDefaulters: fd.get('hideDefaulters') === 'on',
        defaulterMin: Number(str(fd, 'defaulterMin') || 0),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back('/exams/report-cards?new=1', error.problem.type, detailOf(error));
    throw error;
  }
  back(
    `/exams/report-cards/${made!.id}?tab=setup`,
    'ok',
    'Release made: check the template of each class, then the readiness',
  );
}

export async function saveReleaseSetup(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) back('/exams/report-cards', 'validation-failed', 'Unknown release');
  const templates: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (
      /^tpl:(pre_primary|primary|middle|secondary|senior|class_\d{1,18})$/.test(k) &&
      okId(String(v))
    )
      templates[k.slice(4)] = String(v);
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: str(fd, 'name'),
          examIds: fd.getAll('examIds').map(String).filter(okId),
          templates,
          hideDefaulters: fd.get('hideDefaulters') === 'on',
          defaulterMin: Number(str(fd, 'defaulterMin') || 0),
        }),
      }),
    'Set-up saved',
  );
}

export async function setReleaseStatus(fd: FormData) {
  const id = str(fd, 'id');
  const status = str(fd, 'status');
  if (!okId(id) || !['draft', 'submitted', 'released', 'withdrawn'].includes(status))
    back('/exams/report-cards', 'validation-failed', 'Unknown step');
  const reason = str(fd, 'reason');
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      }),
    {
      submitted: 'Sent to the principal',
      released:
        'Published: families see the cards in the app; send the message from Message to parents',
      withdrawn: 'Withdrawn from the families',
      draft: 'Back to a draft',
    }[status],
  );
}

/** a release's class published to its families, or revoked with a reason (docs/design/65, 1 Nov) */
export async function setClassPublish(fd: FormData) {
  const id = str(fd, 'id');
  const classId = str(fd, 'classId');
  const status = str(fd, 'status');
  if (!okId(id) || !okId(classId) || !['released', 'withdrawn'].includes(status))
    back('/exams/report-cards', 'validation-failed', 'Unknown class');
  const reason = str(fd, 'reason');
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}/classes/${classId}`, {
        method: 'PUT',
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      }),
    status === 'released'
      ? `${str(fd, 'label')} published: send the message from Message to parents when you choose`
      : `${str(fd, 'label')} revoked`,
  );
}

/**
 * docs/design/82: the principal sends the report card message to the families of a published class
 * (or every published class) not told yet, on the channels ticked.
 */
export async function tellParents(fd: FormData) {
  const id = str(fd, 'id');
  const classId = str(fd, 'classId');
  if (!okId(id) || (classId && !okId(classId)))
    back('/exams/report-cards', 'validation-failed', 'Unknown class');
  const channels = fd
    .getAll('channels')
    .map(String)
    .filter((x) => x === 'email' || x === 'sms');
  const to = backTo(fd, id);
  let r: { told: { email: number; sms: number }; messages: number };
  try {
    r = await apiFetch(`/exams/report-cards/releases/${id}/tell`, {
      method: 'POST',
      body: JSON.stringify({ channels, ...(classId ? { classIds: [classId] } : {}) }),
    });
  } catch (error) {
    if (error instanceof ApiError) back(to, error.problem.type, detailOf(error));
    throw error;
  }
  const by = [
    r.told.email ? `${String(r.told.email)} by e-mail` : '',
    r.told.sms ? `${String(r.told.sms)} by SMS` : '',
  ].filter(Boolean);
  back(
    to,
    'ok',
    `Sent to the parents: ${by.join(' and ') || 'no family'} (${String(r.messages)} messages queued)`,
  );
}

// ---- the Cards line (client components call these and show the answer in place) -----------------
type Out<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof ApiError)
    return { ok: false, error: detailOf(e) ?? e.problem.title ?? e.problem.type };
  throw e;
};
/** "s:<section id>" or "c:<class id>" (every section of the class) */
const placeOf = (place: string) => {
  const m = /^([sc]):(\d{1,18})$/.exec(place);
  return m ? (m[1] === 's' ? { classSectionId: m[2]! } : { classId: m[2]! }) : null;
};
const STATUSES = ['active', 'inactive', 'all'];
const RANGES = ['first10', '11-20', '21-30', '31-40', 'above40', '1-2', 'all'];

export interface LineStudent {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  section: string;
  heldReason: string | null;
  withheld: boolean;
  /** the fee rule withholds the card today (docs/design/75) */
  feeDue: boolean;
}

/** the students of a line's section or class with the status chosen, section by section in roll order */
export async function lineStudents(
  releaseId: string,
  place: string,
  status: string,
): Promise<Out<LineStudent[]>> {
  const p = placeOf(place);
  if (!okId(releaseId) || !p || !STATUSES.includes(status))
    return { ok: false, error: 'Pick a class' };
  try {
    const q = new URLSearchParams({ status });
    for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
    const r = await apiFetch<{
      data: Array<LineStudent & { heldReason?: string | null; feeDue?: boolean }>;
    }>(`/exams/report-cards/releases/${releaseId}/cards?${q.toString()}`);
    return {
      ok: true,
      data: r.data.map((x) => ({
        studentId: x.studentId,
        name: x.name,
        admissionNo: x.admissionNo,
        rollNo: x.rollNo,
        section: x.section,
        heldReason: x.heldReason ?? null,
        withheld: x.withheld,
        feeDue: x.feeDue ?? false,
      })),
    };
  } catch (e) {
    return fail(e);
  }
}

/** Generate Report Card on a line: the PDF is made in the background; the page then downloads it */
export async function generateLine(
  releaseId: string,
  input: { place: string; range: string; status: string; admissionNo: string },
): Promise<Out<{ exportId: string; students: number; title: string }>> {
  const p = placeOf(input.place);
  const admissionNo = input.admissionNo.trim();
  if (!okId(releaseId) || !p) return { ok: false, error: 'Pick a class' };
  if (!STATUSES.includes(input.status) || (input.range && !RANGES.includes(input.range)))
    return { ok: false, error: 'Pick the roll numbers' };
  if (!input.range && !admissionNo)
    return { ok: false, error: 'Pick the roll numbers, or type one admission number' };
  try {
    const r = await apiFetch<{ exportId: string; students: number; title: string }>(
      `/exams/report-cards/releases/${releaseId}/generate`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...p,
          status: input.status,
          ...(admissionNo ? { admissionNo } : { range: input.range }),
        }),
      },
    );
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

/** a card held back with a reason, or shown again, from the preview panel */
export async function holdInline(
  releaseId: string,
  studentId: string,
  held: boolean,
  reason: string,
): Promise<Out<null>> {
  if (!okId(releaseId) || !okId(studentId)) return { ok: false, error: 'Unknown student' };
  try {
    await apiFetch(`/exams/report-cards/releases/${releaseId}/holds`, {
      method: 'PUT',
      body: JSON.stringify({
        studentId,
        held,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    });
    revalidatePath(`/exams/report-cards/${releaseId}`);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e);
  }
}

export interface ExportLogRow {
  id: string;
  title: string;
  status: string;
  error: string | null;
  requestedAt: string;
  finishedAt: string | null;
  by: string | null;
}

/** the Download Log: the PDFs made for the release, newest first */
export async function releaseExports(releaseId: string): Promise<Out<ExportLogRow[]>> {
  if (!okId(releaseId)) return { ok: false, error: 'Unknown release' };
  try {
    const r = await apiFetch<{ data: ExportLogRow[] }>(
      `/exams/report-cards/releases/${releaseId}/exports`,
    );
    return { ok: true, data: r.data };
  } catch (e) {
    return fail(e);
  }
}

// ---- holds in bulk (docs/design/75) ---------------------------------------------------------------
export interface HeldRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  classId: string;
  sectionId: string;
  section: string;
  reason: string;
  heldBy: string | null;
  heldAt: string;
}
export interface HoldFilter {
  classId?: string;
  classSectionId?: string;
  q?: string;
}
const filterQuery = (f: HoldFilter) => {
  const q = new URLSearchParams();
  if (f.classSectionId && okId(f.classSectionId)) q.set('classSectionId', f.classSectionId);
  else if (f.classId && okId(f.classId)) q.set('classId', f.classId);
  if (f.q?.trim()) q.set('q', f.q.trim().slice(0, 60));
  return q;
};

/** the release's held cards in the person's classes, as filtered; the fee rule's count beside them */
export async function releaseHolds(
  releaseId: string,
  f: HoldFilter,
): Promise<Out<{ data: HeldRow[]; feeWithheld: number | null }>> {
  if (!okId(releaseId)) return { ok: false, error: 'Unknown report card' };
  try {
    const q = filterQuery(f).toString();
    return {
      ok: true,
      data: await apiFetch(`/exams/report-cards/releases/${releaseId}/holds${q ? `?${q}` : ''}`),
    };
  } catch (e) {
    return fail(e);
  }
}

export interface BulkHoldResult {
  held: number;
  alsoHeld: number;
  lifted: number;
  notified: number;
  unchanged: Array<{ studentId: string; name: string; section: string; reason: string | null }>;
  refused: Array<{ key: string; name: string | null; error: string }>;
}

/** many cards held with one reason (also in other published cards), or shown again */
export async function bulkHold(
  releaseId: string,
  input: { studentIds: string[]; held: boolean; reason?: string; alsoReleaseIds?: string[] },
): Promise<Out<BulkHoldResult>> {
  const ids = input.studentIds.filter(okId).slice(0, 500);
  if (!okId(releaseId) || !ids.length) return { ok: false, error: 'Tick the students' };
  try {
    const r = await apiFetch<BulkHoldResult>(
      `/exams/report-cards/releases/${releaseId}/holds/bulk`,
      {
        method: 'POST',
        body: JSON.stringify({
          studentIds: ids,
          held: input.held,
          ...(input.held ? { reason: (input.reason ?? '').trim() } : {}),
          ...(input.held && input.alsoReleaseIds?.length
            ? { alsoReleaseIds: input.alsoReleaseIds.filter(okId) }
            : {}),
        }),
      },
    );
    revalidatePath(`/exams/report-cards/${releaseId}`);
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}

/** an Excel of admission numbers (and reasons): checked, then the good rows held with apply */
export async function uploadHolds(
  releaseId: string,
  reason: string,
  alsoReleaseIds: string[],
  file: string,
  apply: boolean,
): Promise<Out<UploadPreview>> {
  if (!okId(releaseId)) return { ok: false, error: 'Unknown report card' };
  try {
    const r = await apiFetch<UploadPreview>(
      `/exams/report-cards/releases/${releaseId}/holds/upload`,
      {
        method: 'POST',
        body: JSON.stringify({
          file,
          apply,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(alsoReleaseIds.length ? { alsoReleaseIds: alsoReleaseIds.filter(okId) } : {}),
        }),
      },
    );
    if (r.applied) revalidatePath(`/exams/report-cards/${releaseId}`);
    return { ok: true, data: r };
  } catch (e) {
    return fail(e);
  }
}
