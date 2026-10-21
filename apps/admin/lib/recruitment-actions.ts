'use server';
/** Recruitment, part 1 (docs/design/34-recruitment.md): vacancies, their approval and the stages. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ApprovalLevel, ExportSetup, RecruitmentNotices, StageKind } from './recruitment';

const BASE = '/people/recruitment';
const PAGE = '/people/recruitment';
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);
type Out = { ok: true } | { ok: false; error: string };

function back(path: string, error: unknown): never {
  if (error instanceof ApiError) {
    const list = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail = list?.length
      ? list.map((x) => x.message).join('; ')
      : String(error.problem.detail ?? '');
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
}
const done = (path: string, detail: string): never =>
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(detail)}`);

/** The stage list from the client editor, saved at once. */
export async function saveRecruitmentStages(
  stages: Array<{
    id?: string;
    name: string;
    kind: StageKind;
    maxMarks: number | null;
    active: boolean;
    emailScheduled: boolean;
    emailResult: boolean;
  }>,
): Promise<Out> {
  try {
    await apiFetch(`${BASE}/setup/stages`, { method: 'PUT', body: JSON.stringify({ stages }) });
  } catch (e) {
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
  }
  revalidatePath(`${PAGE}/setup`);
  return { ok: true };
}

/** The vacancy form's fields (new and edit). */
function body(fd: FormData) {
  const opt = (k: string) => str(fd, k) || null;
  const posts = Number(str(fd, 'posts') || '1');
  return {
    title: str(fd, 'title'),
    designation: opt('designation'),
    department: opt('department'),
    subject: opt('subject'),
    employeeType: opt('employeeType'),
    campusId: okId(str(fd, 'campusId')) ? str(fd, 'campusId') : null,
    posts: Number.isFinite(posts) ? Math.trunc(posts) : 1,
    qualification: opt('qualification'),
    experience: opt('experience'),
    payBand: opt('payBand'),
    description: opt('description'),
    stageIds: fd.getAll('stageIds').map(String).filter(okId),
  };
}

export async function createVacancy(fd: FormData) {
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>(`${BASE}/vacancies`, {
        method: 'POST',
        body: JSON.stringify(body(fd)),
      })
    ).id;
  } catch (error) {
    back(`${PAGE}/new`, error);
  }
  revalidatePath(PAGE);
  done(`${PAGE}/${id}`, 'The vacancy is saved as a draft. Send it for approval when it is ready.');
}

export async function updateVacancy(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect(PAGE);
  try {
    await apiFetch(`${BASE}/vacancies/${id}`, { method: 'PUT', body: JSON.stringify(body(fd)) });
  } catch (error) {
    back(`${PAGE}/${id}`, error);
  }
  revalidatePath(`${PAGE}/${id}`);
  done(`${PAGE}/${id}`, 'Saved.');
}

/** Submit, publish, close or cancel (ConfirmAction sends the note as `reason`). */
async function act(fd: FormData, what: 'submit' | 'publish' | 'close' | 'cancel', ok: string) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect(PAGE);
  const payload =
    what === 'publish'
      ? { opensAt: str(fd, 'opensAt'), closesAt: str(fd, 'closesAt') }
      : what === 'submit'
        ? {}
        : { note: str(fd, 'reason') || undefined };
  try {
    await apiFetch(`${BASE}/vacancies/${id}/${what}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    back(`${PAGE}/${id}`, error);
  }
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/${id}`);
  done(`${PAGE}/${id}`, ok);
}
export async function submitVacancy(fd: FormData) {
  await act(fd, 'submit', 'Sent for approval. It shows in the approvers’ header approvals.');
}
export async function publishVacancy(fd: FormData) {
  await act(
    fd,
    'publish',
    'Published: the careers page takes applications from the opening to the last date and time.',
  );
}

/** The approver's decision on the vacancy waiting with them (ConfirmAction sends the note as `reason`). */
async function decide(fd: FormData, what: 'approve' | 'send-back', ok: string) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect(PAGE);
  try {
    await apiFetch(`${BASE}/vacancies/${id}/${what}`, {
      method: 'POST',
      body: JSON.stringify({ note: str(fd, 'reason') || undefined }),
    });
  } catch (error) {
    back(`${PAGE}/${id}`, error);
  }
  revalidatePath(PAGE);
  revalidatePath(`${PAGE}/${id}`);
  done(`${PAGE}/${id}`, ok);
}
export async function approveVacancy(fd: FormData) {
  await decide(fd, 'approve', 'Approved. It goes to the next level, or is ready to publish.');
}
export async function sendBackVacancy(fd: FormData) {
  await decide(fd, 'send-back', 'Sent back to the person who raised it, with your reason.');
}

/** Who approves a vacancy, level by level, saved at once from the set-up editor. */
export async function saveVacancyApproval(
  levels: ApprovalLevel[],
): Promise<{ ok: true; moved: number; approved: number } | { ok: false; error: string }> {
  let r: { moved: number; approved: number };
  try {
    r = await apiFetch(`${BASE}/setup/approval`, {
      method: 'PUT',
      body: JSON.stringify({
        levels: levels.map((l) => ({
          name: l.name.trim(),
          by: l.by,
          employeeIds: l.by === 'employees' ? l.employeeIds : [],
          ...(l.by === 'designation' && l.designation ? { designation: l.designation } : {}),
          ...(l.by === 'role' && l.roleCode ? { roleCode: l.roleCode } : {}),
          slaHours: l.slaHours,
        })),
      }),
    });
  } catch (e) {
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
  }
  revalidatePath(`${PAGE}/setup`);
  revalidatePath(PAGE);
  return { ok: true, moved: r.moved, approved: r.approved };
}
export async function closeVacancy(fd: FormData) {
  await act(fd, 'close', 'Closed: no new applications.');
}
export async function cancelVacancy(fd: FormData) {
  await act(fd, 'cancel', 'Cancelled.');
}

// ---- part 3: candidates and screening -----------------------------------------------------------------

const APP_PAGE = '/people/recruitment/applications';
const CANDIDATES = '/people/recruitment/candidates';
/** Where to come back to: only the recruitment screens, never an outside address. */
const backTo = (fd: FormData, fallback: string) => {
  const raw = str(fd, 'back');
  return /^\/people\/recruitment(\/[\w/-]*)?(\?[\w=&%.+-]*)?$/.test(raw) ? raw : fallback;
};
/** The schedule and result fields of a stage form (date-time, venue, panel, marks, result, remarks). */
function stageBody(fd: FormData) {
  const marks = str(fd, 'marks');
  const result = str(fd, 'result');
  return {
    ...(str(fd, 'scheduledAt') ? { scheduledAt: str(fd, 'scheduledAt').slice(0, 16) } : {}),
    ...(str(fd, 'venue') ? { venue: str(fd, 'venue') } : {}),
    ...(str(fd, 'panel') ? { panel: str(fd, 'panel') } : {}),
    ...(marks !== '' && Number.isFinite(Number(marks)) ? { marks: Number(marks) } : {}),
    ...(['pass', 'fail', 'hold'].includes(result) ? { result } : {}),
    ...(str(fd, 'remarks') ? { remarks: str(fd, 'remarks') } : {}),
  };
}

/** One application's current stage: the schedule, or the marks and result. */
export async function recordStage(fd: FormData) {
  const id = str(fd, 'id');
  const stageId = str(fd, 'stageId');
  const page = `${APP_PAGE}/${id}`;
  if (!okId(id) || !okId(stageId)) redirect(CANDIDATES);
  try {
    await apiFetch(`${BASE}/applications/${id}/stages/${stageId}`, {
      method: 'POST',
      body: JSON.stringify(stageBody(fd)),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(page);
  done(page, 'Saved.');
}

/** The ticked candidates at one stage: each button sends its own result (no button name reaches a server action). */
async function bulk(fd: FormData, result: 'pass' | 'fail' | 'hold' | null, ok: string) {
  const page = backTo(fd, CANDIDATES);
  const ids = fd.getAll('ids').map(String).filter(okId);
  const stageId = str(fd, 'stageId');
  if (!ids.length)
    redirect(
      `${page}${page.includes('?') ? '&' : '?'}error=validation-failed&detail=${encodeURIComponent('Tick the candidates first')}`,
    );
  let out: { done: number; skipped: string[] } = { done: 0, skipped: [] };
  try {
    out = await apiFetch(`${BASE}/applications/bulk`, {
      method: 'POST',
      body: JSON.stringify({ ids, stageId, ...stageBody(fd), ...(result ? { result } : {}) }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(CANDIDATES);
  done(
    page,
    `${ok}: ${String(out.done)}.${out.skipped.length ? ` Not at this stage, left as they were: ${out.skipped.join(', ')}.` : ''}`,
  );
}
export async function bulkPass(fd: FormData) {
  await bulk(fd, 'pass', 'Passed this stage');
}
export async function bulkFail(fd: FormData) {
  await bulk(fd, 'fail', 'Not taken forward');
}
export async function bulkHold(fd: FormData) {
  await bulk(fd, 'hold', 'Put on hold');
}
export async function bulkSchedule(fd: FormData) {
  await bulk(fd, null, 'Scheduled');
}

export async function rejectApplication(fd: FormData) {
  const id = str(fd, 'id');
  const page = `${APP_PAGE}/${id}`;
  if (!okId(id)) redirect(CANDIDATES);
  try {
    await apiFetch(`${BASE}/applications/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note: str(fd, 'reason') || undefined }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(page);
  done(page, 'Not taken forward.');
}

export async function resumeApplication(fd: FormData) {
  const id = str(fd, 'id');
  const page = `${APP_PAGE}/${id}`;
  if (!okId(id)) redirect(CANDIDATES);
  try {
    await apiFetch(`${BASE}/applications/${id}/resume`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(page);
  done(page, 'Taken up again at the same stage.');
}

// ---- part 8: putting an application right ----------------------------------------------------------------

/** One correction action on an application, back to its page with what happened. */
async function correct(fd: FormData, path: string, body: unknown, ok: string) {
  const id = str(fd, 'id');
  const page = `${APP_PAGE}/${id}`;
  if (!okId(id)) redirect(CANDIDATES);
  try {
    await apiFetch(`${BASE}/applications/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(page);
  done(page, ok);
}
export async function undoDecision(fd: FormData) {
  await correct(
    fd,
    'undo',
    { reason: str(fd, 'reason') },
    'Undone: the application is back where it was.',
  );
}
export async function moveStage(fd: FormData) {
  await correct(
    fd,
    'move',
    { stageId: str(fd, 'stageId'), reason: str(fd, 'reason') },
    'The application is at the stage chosen.',
  );
}
export async function sendBackApplication(fd: FormData) {
  await correct(
    fd,
    'send-back',
    {
      remark: str(fd, 'remark'),
      steps: fd.getAll('steps').map(String),
      dueOn: str(fd, 'dueOn'),
    },
    'Sent back to the candidate, with an email. Screening waits until it comes back.',
  );
}
export async function cancelCorrection(fd: FormData) {
  await correct(
    fd,
    'send-back/cancel',
    { reason: str(fd, 'reason') || undefined },
    'The request is taken back; the application goes on as it was.',
  );
}

/** Who may undo decisions and change stages, and the time to correct (Recruitment set-up). */
export async function saveCorrectionSettings(s: {
  undoHours: number;
  undoRoles: string[];
  undoEmployeeIds: string[];
  correctionDays: number;
}): Promise<Out> {
  try {
    await apiFetch(`${BASE}/setup/corrections`, { method: 'PUT', body: JSON.stringify(s) });
  } catch (e) {
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
  }
  revalidatePath(`${PAGE}/setup`);
  return { ok: true };
}

/** A candidate the office met (walk-in, referral), added to a vacancy. */
export async function addWalkIn(fd: FormData) {
  const page = backTo(fd, CANDIDATES);
  let out = { id: '', number: '' };
  try {
    out = await apiFetch(`${BASE}/applications`, {
      method: 'POST',
      body: JSON.stringify({
        vacancyId: str(fd, 'vacancyId'),
        firstName: str(fd, 'firstName'),
        lastName: str(fd, 'lastName') || undefined,
        gender: str(fd, 'gender'),
        dob: str(fd, 'dob') || undefined,
        mobile: str(fd, 'mobile'),
        email: str(fd, 'email') || undefined,
      }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(CANDIDATES);
  done(
    `${APP_PAGE}/${out.id}`,
    `Added as application ${out.number}. The candidate can complete the form online with this mobile.`,
  );
}

export async function saveRecruitmentNotices(input: RecruitmentNotices): Promise<Out> {
  try {
    await apiFetch(`${BASE}/setup/notices`, { method: 'PUT', body: JSON.stringify(input) });
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
  revalidatePath(`${PAGE}/setup`);
  return { ok: true };
}

// ---- part 4: from selected candidate to employee ---------------------------------------------------

/** The move: the employment set here, the documents given a type; the new employee's page after. */
export async function joinCandidate(fd: FormData) {
  const id = str(fd, 'id');
  const page = `${APP_PAGE}/${id}`;
  if (!okId(id)) redirect(CANDIDATES);
  const documents: Array<{ id: string; typeId: string | null }> = [];
  for (const [k, v] of fd.entries()) {
    const m = /^doc\.(\d{1,18})$/.exec(k);
    if (m) documents.push({ id: m[1]!, typeId: okId(String(v)) ? String(v) : null });
  }
  let out = { employeeId: '', code: '' };
  try {
    out = await apiFetch(`${BASE}/applications/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({
        joinedOn: str(fd, 'joinedOn'),
        ...(str(fd, 'employeeCode') ? { employeeCode: str(fd, 'employeeCode') } : {}),
        ...(str(fd, 'department') ? { department: str(fd, 'department') } : {}),
        ...(str(fd, 'designation') ? { designation: str(fd, 'designation') } : {}),
        ...(str(fd, 'employeeType') ? { employeeType: str(fd, 'employeeType') } : {}),
        ...(str(fd, 'natureOfAppointment')
          ? { natureOfAppointment: str(fd, 'natureOfAppointment') }
          : {}),
        createLogin: fd.get('createLogin') === 'yes',
        confirmMatch: fd.get('confirmMatch') === 'yes',
        documents,
      }),
    });
  } catch (error) {
    back(page, error);
  }
  revalidatePath(page);
  redirect(`/people/employees/${out.employeeId}?ok=joined`);
}

// ---- part 10: the Excel export with the fields picked ----------------------------------------------------

/** What the export picker shows; read when it opens. */
export async function loadExportSetup(): Promise<ExportSetup> {
  return apiFetch<ExportSetup>(`${BASE}/export/setup`);
}

function problem(e: unknown): string {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<{ message?: string }> | undefined;
    return list?.length
      ? list.map((x) => x.message).join('; ')
      : (e.problem.detail ?? e.problem.type);
  }
  throw e;
}

/** A named layout saved for the school (the same name changes it). */
export async function saveExportLayout(input: {
  name: string;
  columns: string[];
  sheets: string[];
}): Promise<{ ok: true; id: string; updated: boolean } | { ok: false; error: string }> {
  try {
    const r = await apiFetch<{ id: string; updated: boolean }>(`${BASE}/export/layouts`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
}

export async function deleteExportLayout(id: string): Promise<Out> {
  if (!okId(id)) return { ok: false, error: 'Not found' };
  try {
    await apiFetch(`${BASE}/export/layouts/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
}
