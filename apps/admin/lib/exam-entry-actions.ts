'use server';
/**
 * Examinations v2 (docs/design/65): marks entry in the admin app (codes, grades, Excel), subject
 * choices, locks per entry type, marks codes and the ready-made grade scales.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

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
async function run(path: string, fn: () => Promise<unknown>, done?: string): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, detailOf(error));
    throw error;
  }
  back(path, 'ok', done);
}

type Out<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(path: string, method: string, body: unknown): Promise<Out<T>> {
  try {
    return { ok: true, data: await apiFetch<T>(path, { method, body: JSON.stringify(body) }) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) ?? e.problem.type };
    throw e;
  }
}

// ---- marks --------------------------------------------------------------------------------------
/** The sheet of one section and subject: a mark (or a grade) or a code per student; empty rows skipped. */
export async function saveExamMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/marks`;
  const rows: Array<{
    studentId: string;
    marks: number | null;
    code: string | null;
    grade: string | null;
  }> = [];
  for (const studentId of fd.getAll('studentId').map(String)) {
    const v = str(fd, `v-${studentId}`);
    const code = str(fd, `c-${studentId}`);
    const grade = str(fd, `g-${studentId}`);
    if (!v && !code && !grade) continue;
    rows.push({
      studentId,
      marks: code || grade || !v ? null : Number(v),
      code: code || null,
      grade: code ? null : grade || null,
    });
  }
  if (!rows.length) back(backTo, 'validation-failed', 'Nothing to save: write marks or a code');
  return run(
    backTo,
    () =>
      apiFetch(`/exams/${examId}/marks`, {
        method: 'PUT',
        body: JSON.stringify({
          classSectionId: str(fd, 'classSectionId'),
          subjectId: str(fd, 'subjectId'),
          rows,
        }),
      }),
    `${String(rows.length)} saved`,
  );
}

/** One part of a subject: a mark or AB per student; an empty box clears the part's mark. */
export async function saveExamPartMarks(fd: FormData) {
  const examId = str(fd, 'examId');
  const backTo = str(fd, 'back') || `/exams/${examId}/marks`;
  const rows = fd
    .getAll('studentId')
    .map(String)
    .map((studentId) => {
      const v = str(fd, `v-${studentId}`);
      const absent = str(fd, `c-${studentId}`) === 'AB';
      return { studentId, marks: absent || !v ? null : Number(v), absent };
    });
  return run(backTo, () =>
    apiFetch(`/exams/${examId}/part-marks`, {
      method: 'PUT',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        partId: str(fd, 'partId'),
        rows,
      }),
    }),
  );
}

export interface UploadPreview {
  columns?: string[];
  rows: Array<{
    row: number;
    admissionNo: string;
    name: string | null;
    values?: Record<string, string>;
    subjects?: number;
    error: string | null;
  }>;
  ready: number;
  errors: number;
  applied: boolean;
}

/** Bound to the exam, section and subject on the page; the client sends the file (base64). */
export async function uploadExamMarks(
  examId: string,
  classSectionId: string,
  subjectId: string,
  file: string,
  apply: boolean,
): Promise<Out<UploadPreview>> {
  if (!okId(examId) || !okId(classSectionId) || !okId(subjectId))
    return { ok: false, error: 'Choose the section and subject' };
  const out = await call<UploadPreview>(`/exams/${examId}/marks/upload`, 'POST', {
    classSectionId,
    subjectId,
    file,
    apply,
  });
  if (out.ok && out.data.applied) revalidatePath(`/exams/${examId}/marks`);
  return out;
}

// ---- subject choices ----------------------------------------------------------------------------
export async function saveSubjectChoices(fd: FormData) {
  const sectionId = str(fd, 'classSectionId');
  const backTo = `/exams/subject-choices?sectionId=${sectionId}`;
  const subjects = fd.getAll('subjectId').map(String);
  const rows = fd
    .getAll('studentId')
    .map(String)
    .map((studentId) => ({
      studentId,
      stream: str(fd, `stream-${studentId}`) || null,
      subjects: subjects
        .map((subjectId) => ({ subjectId, kind: str(fd, `k-${studentId}-${subjectId}`) }))
        .filter((x): x is { subjectId: string; kind: 'compulsory' | 'optional' | 'additional' } =>
          ['compulsory', 'optional', 'additional'].includes(x.kind),
        ),
    }));
  return run(backTo, () =>
    apiFetch('/exams/subject-choices', {
      method: 'PUT',
      body: JSON.stringify({ classSectionId: sectionId, rows }),
    }),
  );
}

export async function fillSubjectChoices(fd: FormData) {
  const sectionId = str(fd, 'classSectionId');
  return run(`/exams/subject-choices?sectionId=${sectionId}`, () =>
    apiFetch('/exams/subject-choices/defaults', {
      method: 'POST',
      body: JSON.stringify({ classSectionId: sectionId }),
    }),
  );
}

/** Bound to the section on the page; the client sends the file (base64). */
export async function uploadSubjectChoices(
  classSectionId: string,
  file: string,
  apply: boolean,
): Promise<Out<UploadPreview>> {
  if (!okId(classSectionId)) return { ok: false, error: 'Choose the section' };
  const out = await call<UploadPreview>('/exams/subject-choices/upload', 'POST', {
    classSectionId,
    file,
    apply,
  });
  if (out.ok && out.data.applied) revalidatePath('/exams/subject-choices');
  return out;
}

// ---- locks, codes, scales -----------------------------------------------------------------------
export async function setClassLocks(fd: FormData) {
  const examId = str(fd, 'examId');
  const classId = str(fd, 'classId');
  const on = (k: string) => fd.get(k) !== null;
  return run(`/exams/${examId}?classId=${classId}`, () =>
    apiFetch(`/exams/${examId}/class-locks`, {
      method: 'PUT',
      body: JSON.stringify({
        classId,
        marks: on('marks'),
        indicators: on('indicators'),
        remarks: on('remarks'),
        attendance: on('attendance'),
        health: on('health'),
      }),
    }),
  );
}

export async function saveMarkCode(fd: FormData) {
  const treatment = str(fd, 'treatment');
  const value = str(fd, 'value');
  return run('/exams/masters?tab=codes', () =>
    apiFetch('/exams/mark-codes', {
      method: 'PUT',
      body: JSON.stringify({
        code: str(fd, 'code'),
        name: str(fd, 'name'),
        treatment,
        value: ['fixed', 'percent'].includes(treatment) && value ? Number(value) : null,
        blocksResult: fd.get('blocksResult') !== null,
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
        status: str(fd, 'status') || 'active',
      }),
    }),
  );
}

export async function installGradeScalePresets() {
  return run('/exams/masters', () => apiFetch('/exams/grade-scales/presets', { method: 'POST' }));
}

// ---- submit, verify, reopen (docs/design/65, part 2) ----------------------------------------------
/** submit | verify | send-back | reopen for one section's subject; back to the page it came from. */
export async function markEntryStatus(fd: FormData) {
  const examId = str(fd, 'examId');
  const action = str(fd, 'action');
  const backTo = str(fd, 'back') || `/exams/${examId}/status`;
  if (!['submit', 'verify', 'send-back', 'reopen'].includes(action))
    back(backTo, 'validation-failed', 'Unknown step');
  const note = str(fd, 'note');
  const done: Record<string, string> = {
    submit: 'Submitted for verification',
    verify: 'Verified and locked',
    'send-back': 'Sent back to the teacher',
    reopen: 'Reopened',
  };
  return run(
    backTo,
    () =>
      apiFetch(`/exams/${examId}/entry-status/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          classSectionId: str(fd, 'classSectionId'),
          subjectId: str(fd, 'subjectId'),
          ...(action === 'send-back' || action === 'reopen'
            ? { note }
            : note
              ? { remark: note }
              : {}),
        }),
      }),
    done[action],
  );
}

// ---- mark schemes (docs/design/65, part 3) --------------------------------------------------------
export async function createMarkScheme(fd: FormData) {
  const preset = str(fd, 'preset');
  const examMap: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (k.startsWith('map:') && String(v)) examMap[k.slice(4)] = String(v);
  const classIds = fd.getAll('classId').map(String).filter(okId);
  let made: { id: string } | undefined;
  try {
    made = await apiFetch<{ id: string }>('/exams/schemes', {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        purpose: str(fd, 'purpose') || 'result',
        termCode: str(fd, 'termCode') || undefined,
        classIds,
        ...(preset
          ? { preset, examMap }
          : {
              // a blank scheme: one exam and its marks as the total, built up on the scheme's page
              def: {
                exams: [{ key: 'EXAM1', examId: str(fd, 'examId') }],
                columns: [
                  { key: 'EXAM1', label: 'Marks', kind: 'raw', exam: 'EXAM1', total: true },
                ],
                result: { passPct: 33, compartmentUpTo: 2, rankBy: 'total' },
              },
            }),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back(`/exams/schemes?preset=${preset}`, error.problem.type, detailOf(error));
    throw error;
  }
  back(`/exams/schemes/${made!.id}`, 'ok', 'Scheme made: try it on a section, then lock it');
}

export async function saveMarkScheme(
  id: string,
  body: { name?: string; termCode?: string | null; classIds?: string[]; def?: unknown },
): Promise<Out<{ problems: string[] }>> {
  if (!okId(id)) return { ok: false, error: 'Unknown scheme' };
  const out = await call<{ problems: string[] }>(`/exams/schemes/${id}`, 'PUT', body);
  if (out.ok) revalidatePath(`/exams/schemes/${id}`);
  return out;
}

/** lock | new-version | compute | remove */
export async function markSchemeStep(fd: FormData) {
  const id = str(fd, 'id');
  const step = str(fd, 'step');
  if (!okId(id) || !['lock', 'new-version', 'compute', 'remove'].includes(step))
    back('/exams/schemes', 'validation-failed', 'Unknown step');
  let next = `/exams/schemes/${id}`;
  try {
    if (step === 'remove') {
      await apiFetch(`/exams/schemes/${id}`, { method: 'DELETE' });
      next = '/exams/schemes';
    } else {
      const r = await apiFetch<{ id: string; counts?: Record<string, number> }>(
        `/exams/schemes/${id}/${step}`,
        { method: 'POST' },
      );
      next = `/exams/schemes/${r.id}`;
      if (step === 'compute')
        back(
          next,
          'ok',
          `Term results worked out: ${Object.entries(r.counts ?? {})
            .map(([k, n]) => `${k} ${String(n)}`)
            .join(', ')}`,
        );
    }
  } catch (error) {
    if (error instanceof ApiError)
      back(`/exams/schemes/${id}`, error.problem.type, detailOf(error));
    throw error;
  }
  back(
    next,
    'ok',
    { lock: 'Locked', 'new-version': 'A new version to change', remove: 'Removed' }[step],
  );
}

// ---- the DPS Noida cards (docs/design/65, part 4) -------------------------------------------------
export async function installDpsCards() {
  return run(
    '/exams/report-cards/templates',
    () => apiFetch('/exams/report-cards/templates/dps', { method: 'POST' }),
    'The DPS Noida cards are installed: choose them per class on the release',
  );
}

export async function saveSignature(
  id: string | null,
  body: {
    role: string;
    label: string;
    personName?: string | null;
    classIds: string[];
    status?: 'active' | 'inactive';
    image?: { contentType: 'image/png' | 'image/jpeg'; base64: string };
  },
): Promise<Out<unknown>> {
  if (id && !okId(id)) return { ok: false, error: 'Unknown signature' };
  const out = await call(
    id ? `/exams/report-cards/signatures/${id}` : '/exams/report-cards/signatures',
    id ? 'PUT' : 'POST',
    body,
  );
  if (out.ok) revalidatePath('/exams/report-cards/signatures');
  return out;
}

/** The template of each class on a release (class_<id>), the band ones kept. */
export async function setReleaseClassTemplates(fd: FormData) {
  const id = str(fd, 'releaseId');
  const templates: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (/^(tpl:)(pre_primary|primary|middle|secondary|senior|class_\d{1,18})$/.test(k) && String(v))
      templates[k.slice(4)] = String(v);
  return run(
    `/exams/report-cards?release=${id}`,
    () =>
      apiFetch(`/exams/report-cards/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ templates }),
      }),
    'Templates saved',
  );
}
