'use server';
/** Employee ACR set-up (docs/design/32-employee-acr.md). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { AcrBand, AcrLevel, StaffGroup } from './acr';

const SETUP = '/people/acr/setup';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
type Out = { ok: true } | { ok: false; error: string };

function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 300))}`,
    );
  throw error;
}
const back_ = back;
const problem = (e: unknown): { ok: false; error: string } => {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<{ message?: string }> | undefined;
    return {
      ok: false,
      error: list?.length
        ? list.map((x) => x.message).join('; ')
        : (e.problem.detail ?? e.problem.type),
    };
  }
  throw e;
};

/**
 * The ACR PDF: one ACR from its page, or the ACRs shown on the board (up to 100). An export the
 * workers render; the page comes back with ?export= and waits for the file.
 */
export async function requestAcrPdf(fd: FormData) {
  const ids = str(fd, 'ids').split(',').filter(okId).slice(0, 100);
  const raw = str(fd, 'back');
  // only the ACR screens, never an outside address
  const backTo = /^\/people\/acr(\/\d{1,18})?(\?[\w=&%.+-]*)?$/.test(raw) ? raw : '/people/acr';
  if (!ids.length) redirect(backTo);
  let exportId = '';
  try {
    exportId = (
      await apiFetch<{ id: string }>('/people/acr/pdf', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      })
    ).id;
  } catch (error) {
    back(backTo, error);
  }
  redirect(`${backTo}${backTo.includes('?') ? '&' : '?'}export=${exportId}`);
}

/**
 * A file for an attachment question (0194), uploaded as the signed-in person: an image or a PDF up to
 * 5 MB. The sheet puts the id on the answer; the API checks the file is theirs when the answer is saved.
 */
export async function acrUploadFile(
  id: string,
  fd: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!okId(id)) return { ok: false, error: 'Unknown ACR' };
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a file.' };
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type))
    return { ok: false, error: `${file.name}: attach a PDF or an image (JPG, PNG, WebP).` };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: `${file.name} is larger than 5 MB.` };
  try {
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>(`${R(id)}/files`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        contentType: file.type,
        sizeBytes: file.size,
        classification: 'personal',
      }),
    });
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${API_BASE}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok) return { ok: false, error: `${file.name} did not upload.` };
    return { ok: true, id: reg.file.id };
  } catch (e) {
    return problem(e);
  }
}

/** Rating words, days to object and the grade bands (from the client editor). */
export async function saveAcrSettings(input: {
  scaleLabels: string[];
  representationDays: number;
  staffLateAfter: string;
  guidelines: string;
  bands: AcrBand[];
}): Promise<Out> {
  try {
    await apiFetch(`${SETUP}/settings`, { method: 'PUT', body: JSON.stringify(input) });
  } catch (e) {
    return problem(e);
  }
  revalidatePath(SETUP);
  return { ok: true };
}

/** Principal's remarks (0195): the whole list from the client editor; lines left out switch off. */
export async function saveAcrRemarks(
  lines: Array<{ id?: string; grade: string; text: string; sortOrder: number; active: boolean }>,
): Promise<Out> {
  try {
    await apiFetch(`${SETUP}/remarks`, { method: 'PUT', body: JSON.stringify({ lines }) });
  } catch (e) {
    return problem(e);
  }
  revalidatePath(SETUP);
  return { ok: true };
}

/** Principal's remarks from a CSV (grade, remark, status), as the legacy export lays them out. */
export async function importAcrRemarks(fd: FormData) {
  const page = `${SETUP}?tab=remarks`;
  const fail = (detail: string): never =>
    redirect(`${page}&error=validation-failed&detail=${encodeURIComponent(detail)}`);
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) fail('Choose the CSV file.');
  const f = file as File;
  if (f.size > 2 * 1024 * 1024) fail('The file is larger than 2 MB.');
  const text = (await f.text()).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) fail('The file has no rows.');
  const head = csvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const col = (names: string[]) =>
    head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const gi = col(['grade', 'category']);
  const ti = col(['remark', 'text']);
  const si = col(['status', 'active']);
  if (gi < 0 || ti < 0) fail('The file needs a Grade column and a Remark column.');
  const rows = lines.slice(1).map((l) => {
    const c = csvLine(l);
    const st = si >= 0 ? (c[si] ?? '').trim().toLowerCase() : '';
    return {
      grade: (c[gi] ?? '').trim(),
      text: (c[ti] ?? '').trim(),
      active: st ? !/^(inactive|no|off|0|false)$/.test(st) : true,
    };
  });
  let out: { added: number; skipped: number } = { added: 0, skipped: 0 };
  try {
    out = await apiFetch(`${SETUP}/remarks/import`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(SETUP);
  redirect(
    `${page}&ok=1&detail=${encodeURIComponent(`${String(out.added)} lines added, ${String(out.skipped)} skipped (already there or empty).`)}`,
  );
}

/** The levels of one staff group, in order (from the client editor). */
export async function saveAcrLevels(staffGroup: StaffGroup, levels: AcrLevel[]): Promise<Out> {
  try {
    await apiFetch(`${SETUP}/levels`, {
      method: 'PUT',
      body: JSON.stringify({
        staffGroup,
        levels: levels.map((l) => ({
          label: l.label,
          kind: l.kind,
          roleCode: l.roleCode,
          designation: l.designation,
          employeeId: l.employeeId,
          action: l.action,
          formId: l.formId ?? null,
        })),
      }),
    });
  } catch (e) {
    return problem(e);
  }
  revalidatePath(SETUP);
  return { ok: true };
}

// ---- forms, sections and questions (0191) --------------------------------------------------------

const formsBack = (formId?: string) =>
  `${SETUP}?tab=questions${formId && okId(formId) ? `&form=${formId}` : ''}`;

/**
 * Add or change a form (name, part, who it is for, on or off). A level questionnaire may also name
 * the levels that answer it (`levels` ticks as "teaching:2"; `levelsGiven` says the ticks were shown).
 */
export async function saveAcrForm(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = formsBack(id);
  const part = str(fd, 'part') === 'level' ? 'level' : 'self';
  let out: { id: string } | undefined;
  try {
    out = await apiFetch(okId(id) ? `${SETUP}/forms/${id}` : `${SETUP}/forms`, {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        part,
        staffGroup: str(fd, 'staffGroup') || 'teaching',
        description: str(fd, 'description') || null,
        active: str(fd, 'active') !== 'false',
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
        // the employee types a self form is for (0192); a save without the ticks keeps them
        ...(str(fd, 'employeeTypesGiven') === '1'
          ? { employeeTypeIds: fd.getAll('employeeTypeIds').map(String).filter(okId) }
          : {}),
      }),
    });
    if (part === 'level' && str(fd, 'levelsGiven') === '1') {
      const levels = fd
        .getAll('levels')
        .map(String)
        .map((v) => /^(teaching|non_teaching):([1-6])$/.exec(v))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => ({ staffGroup: m[1], seq: Number(m[2]) }));
      await apiFetch(`${SETUP}/forms/${out!.id}/levels`, {
        method: 'PUT',
        body: JSON.stringify({ levels }),
      });
    }
  } catch (error) {
    back(okId(id) ? back_ : out ? formsBack(out.id) : back_, error);
  }
  revalidatePath(SETUP);
  redirect(
    `${formsBack(out!.id)}&ok=1&detail=${encodeURIComponent(okId(id) ? 'Form saved.' : 'Form added: now add its sections and questions.')}`,
  );
}

/** Copy a form with its sections and questions. */
export async function copyAcrForm(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = formsBack(id);
  if (!okId(id)) redirect(formsBack());
  let out: { id: string } | undefined;
  try {
    out = await apiFetch(`${SETUP}/forms/${id}/copy`, {
      method: 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        staffGroup: str(fd, 'staffGroup') || undefined,
      }),
    });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(`${formsBack(out!.id)}&ok=1&detail=${encodeURIComponent('Form copied.')}`);
}

/** Add or change a section (title, help, weight, order). */
export async function saveAcrSection(fd: FormData) {
  const id = str(fd, 'id');
  const formId = str(fd, 'formId');
  const back_ = formsBack(formId);
  if (!okId(formId)) redirect(formsBack());
  try {
    await apiFetch(okId(id) ? `${SETUP}/sections/${id}` : `${SETUP}/sections`, {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        formId,
        title: str(fd, 'title'),
        help: str(fd, 'help') || null,
        weight: Number(str(fd, 'weight') || '1'),
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
      }),
    });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(
    `${back_}&ok=1&detail=${encodeURIComponent(okId(id) ? 'Section saved.' : 'Section added.')}`,
  );
}

/** Remove an empty section. */
export async function removeAcrSection(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = formsBack(str(fd, 'formId'));
  if (!okId(id)) redirect(back_);
  try {
    await apiFetch(`${SETUP}/sections/${id}`, { method: 'DELETE' });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(`${back_}&ok=1&detail=${encodeURIComponent('Section removed.')}`);
}

/** Add or change a question of a section. */
export async function saveAcrQuestion(fd: FormData) {
  const id = str(fd, 'id');
  const formId = str(fd, 'formId');
  const back_ = formsBack(formId);
  if (!okId(formId)) redirect(formsBack());
  const kind = str(fd, 'kind');
  try {
    await apiFetch(okId(id) ? `${SETUP}/questions/${id}` : `${SETUP}/questions`, {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        formId,
        sectionId: str(fd, 'sectionId'),
        text: str(fd, 'text'),
        kind: kind === 'text' || kind === 'yesno' ? kind : 'scale',
        weight: Number(str(fd, 'weight') || '1'),
        required: fd.get('required') === 'on',
        sortOrder: Number(str(fd, 'sortOrder') || '0'),
        active: fd.get('active') !== 'off',
      }),
    });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(
    `${back_}&ok=1&detail=${encodeURIComponent(okId(id) ? 'Question saved.' : 'Question added.')}`,
  );
}

/** Switch a question on or off, or move it (the whole question travels in `q`). */
export async function toggleAcrQuestion(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = formsBack(str(fd, 'formId'));
  if (!okId(id)) redirect(back_);
  try {
    const q = JSON.parse(str(fd, 'q')) as Record<string, unknown>;
    const patch: Record<string, unknown> = { ...q };
    if (str(fd, 'active')) patch.active = str(fd, 'active') === 'true';
    if (str(fd, 'sortOrder')) patch.sortOrder = Number(str(fd, 'sortOrder'));
    await apiFetch(`${SETUP}/questions/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(back_);
}

/** Add or change a cycle (form). */
export async function saveAcrCycle(fd: FormData) {
  const id = str(fd, 'id');
  const back_ = `${SETUP}?tab=cycles`;
  try {
    await apiFetch(okId(id) ? `/people/acr/cycles/${id}` : '/people/acr/cycles', {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        academicYearId: str(fd, 'academicYearId'),
        name: str(fd, 'name'),
        selfFrom: str(fd, 'selfFrom'),
        selfTo: str(fd, 'selfTo'),
        reviewBy: str(fd, 'reviewBy') || null,
      }),
    });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath(SETUP);
  redirect(`${back_}&ok=1&detail=${encodeURIComponent('Cycle saved.')}`);
}

// ---- the flow (part 3 screens) -------------------------------------------------------------------

const R = (id: string) => `/people/acr/reports/${id}`;
type Res = { ok: true } | { ok: false; error: string };
async function call(path: string, method: 'POST' | 'PUT', body?: unknown): Promise<Res> {
  try {
    await apiFetch(path, { method, body: JSON.stringify(body ?? {}) });
  } catch (e) {
    return problem(e);
  }
  revalidatePath('/people/acr');
  revalidatePath('/me/acr');
  return { ok: true };
}
type AnswerMap = Record<string, number | string | string[]>;
interface LevelBody {
  answers: AnswerMap;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
  remarkIds?: string[];
}
export async function acrSaveSelf(id: string, answers: AnswerMap) {
  return okId(id)
    ? call(`${R(id)}/self`, 'PUT', { answers })
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrSubmitSelf(id: string, answers: AnswerMap) {
  return okId(id)
    ? call(`${R(id)}/self/submit`, 'POST', { answers })
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrSaveLevel(id: string, seq: number, body: LevelBody) {
  return okId(id)
    ? call(`${R(id)}/levels/${String(seq)}`, 'PUT', body)
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrSubmitLevel(id: string, seq: number, body: LevelBody) {
  return okId(id)
    ? call(`${R(id)}/levels/${String(seq)}/submit`, 'POST', body)
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrSendBack(id: string, reason: string) {
  return okId(id)
    ? call(`${R(id)}/send-back`, 'POST', { reason })
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrAcknowledge(id: string) {
  return okId(id)
    ? call(`${R(id)}/acknowledge`, 'POST')
    : { ok: false as const, error: 'Unknown ACR' };
}
export async function acrRepresent(id: string, text: string) {
  return okId(id)
    ? call(`${R(id)}/represent`, 'POST', { text })
    : { ok: false as const, error: 'Unknown ACR' };
}

// ---- assessors per employee (0189) ---------------------------------------------------------------

/** Rows changed on the Assessors tab: each assessor as an employee code (or id); null clears. */
export async function saveAcrAssessors(
  rows: Array<{ employee: string; assessors: Record<string, string | null> }>,
): Promise<
  | {
      ok: true;
      changed: number;
      errors: Array<{ employee: string; message: string }>;
      /** the ACRs of the open cycles that followed the records at once */
      openAcrs: { reports: number; changed: number };
    }
  | { ok: false; error: string }
> {
  try {
    const r = await apiFetch<{
      changed: number;
      errors: Array<{ employee: string; message: string }>;
      openAcrs: { reports: number; changed: number };
    }>('/people/acr/setup/assessors', { method: 'PUT', body: JSON.stringify({ rows }) });
    revalidatePath(SETUP);
    return { ok: true, ...r };
  } catch (e) {
    return problem(e);
  }
}

/** One CSV line → cells (quotes and doubled quotes as Excel writes them). */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * The CSV the Assessors tab downloads, filled in and uploaded: a header with employee_code and one
 * column per assessor kind (acr_hod, acr_reviewer, …) holding employee codes; an empty cell clears.
 */
export async function importAcrAssessors(fd: FormData) {
  const back = `${SETUP}?tab=assessors`;
  const f = fd.get('file');
  const fail = (detail: string): never =>
    redirect(`${back}&error=validation-failed&detail=${encodeURIComponent(detail)}`);
  if (!(f instanceof File) || !f.size) fail('Choose the CSV file to upload.');
  const file = f as File;
  if (file.size > 2 * 1024 * 1024) fail('The file is larger than 2 MB.');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) fail('The file has no rows.');
  const header = csvLine(lines[0]!).map((h) => h.toLowerCase());
  const codeCol = header.indexOf('employee_code');
  const kinds = ['acr_hod', 'acr_reviewer', 'approver_l1', 'approver_l2', 'approver_l3'];
  const cols = kinds.map((k) => [k, header.indexOf(k)] as const).filter(([, i]) => i >= 0);
  if (codeCol < 0 || !cols.length)
    fail('The header needs employee_code and at least one of acr_hod, acr_reviewer, approver_l1…');
  const rows = lines.slice(1).map((l) => {
    const cells = csvLine(l);
    const assessors: Record<string, string | null> = {};
    for (const [k, i] of cols) assessors[k] = cells[i] ? cells[i]! : null;
    return { employee: cells[codeCol] ?? '', assessors };
  });
  const valid = rows.filter((r) => r.employee);
  if (!valid.length) fail('No row has an employee code.');
  let out: { changed: number; errors: Array<{ employee: string; message: string }> };
  try {
    out = await apiFetch('/people/acr/setup/assessors', {
      method: 'PUT',
      body: JSON.stringify({ rows: valid.slice(0, 2000) }),
    });
  } catch (error) {
    back_(back, error);
  }
  revalidatePath(SETUP);
  const detail = `${String(out!.changed)} employees updated${
    out!.errors.length
      ? `; ${String(out!.errors.length)} rows not taken: ${out!.errors
          .slice(0, 5)
          .map((e) => `${e.employee} (${e.message})`)
          .join('; ')}`
      : ''
  }.`;
  redirect(`${back}&ok=1&detail=${encodeURIComponent(detail.slice(0, 400))}`);
}

/** The board's "Re-read assessors" for an open cycle. */
export async function acrReresolve(fd: FormData) {
  const id = str(fd, 'cycleId');
  const page = `/people/acr?cycle=${id}`;
  if (!okId(id)) redirect('/people/acr');
  let out: { changed: number; unassigned: Array<{ employeeId: string; level: string }> };
  try {
    out = await apiFetch(`/people/acr/cycles/${id}/reresolve`, { method: 'POST', body: '{}' });
  } catch (error) {
    back_(page, error);
  }
  revalidatePath('/people/acr');
  redirect(
    `${page}&ok=1&detail=${encodeURIComponent(`${String(out!.changed)} levels updated${out!.unassigned.length ? `; ${String(out!.unassigned.length)} levels still have nobody` : ''}.`)}`,
  );
}

/** Start (or top up) a cycle (form on the board). */
export async function acrStartCycle(fd: FormData) {
  const id = str(fd, 'cycleId');
  const back_ = `/people/acr?cycle=${id}`;
  let out: { added: number; unassigned: unknown[] } | undefined;
  try {
    out = await apiFetch(`/people/acr/cycles/${id}/start`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath('/people/acr');
  const n = out!.unassigned.length;
  redirect(
    `${back_}&ok=1&detail=${encodeURIComponent(
      `${String(out!.added)} ACRs started.${n ? ` ${String(n)} levels have nobody set: open those ACRs to choose who fills them.` : ''}`,
    )}`,
  );
}
export async function acrCloseCycle(fd: FormData) {
  const id = str(fd, 'cycleId');
  const back_ = `/people/acr?cycle=${id}`;
  try {
    await apiFetch(`/people/acr/cycles/${id}/close`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(back_, error);
  }
  revalidatePath('/people/acr');
  redirect(`${back_}&ok=1&detail=${encodeURIComponent('Cycle closed.')}`);
}

/** Who fills a level of one ACR (form on the ACR page). */
export async function acrSetPeople(fd: FormData) {
  const id = str(fd, 'id');
  const seq = str(fd, 'seq');
  const ids = fd.getAll('employeeIds').map(String).filter(okId);
  try {
    await apiFetch(`${R(id)}/levels/${seq}/people`, {
      method: 'PUT',
      body: JSON.stringify({ employeeIds: ids }),
    });
  } catch (error) {
    back(`/people/acr/${id}`, error);
  }
  revalidatePath(`/people/acr/${id}`);
  redirect(`/people/acr/${id}?ok=1&detail=${encodeURIComponent('People of the level saved.')}`);
}

/** The office's figures for the year (form on the ACR page). */
export async function acrOffice(fd: FormData) {
  const id = str(fd, 'id');
  const num = (k: string) => (str(fd, k) === '' ? null : Number(str(fd, k)));
  try {
    await apiFetch(`${R(id)}/office`, {
      method: 'PUT',
      body: JSON.stringify({
        cl: num('cl'),
        el: num('el'),
        other: num('other'),
        absent: num('absent'),
        hpl: num('hpl'),
        lateSlips: num('lateSlips'),
        note: str(fd, 'note') || null,
      }),
    });
  } catch (error) {
    back(`/people/acr/${id}`, error);
  }
  revalidatePath(`/people/acr/${id}`);
  redirect(`/people/acr/${id}?ok=1&detail=${encodeURIComponent('Office figures saved.')}`);
}

/** Decide an objection (form on the ACR page). */
export async function acrDecide(fd: FormData) {
  const id = str(fd, 'id');
  const decision = str(fd, 'decision') === 'revised' ? 'revised' : 'upheld';
  try {
    await apiFetch(`${R(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, grade: str(fd, 'grade') || null, note: str(fd, 'note') }),
    });
  } catch (error) {
    back(`/people/acr/${id}`, error);
  }
  revalidatePath(`/people/acr/${id}`);
  redirect(
    `/people/acr/${id}?ok=1&detail=${encodeURIComponent('Decision saved; the ACR is final.')}`,
  );
}
