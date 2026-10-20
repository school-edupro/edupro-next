'use server';
/** Recruitment, part 1 (docs/design/34-recruitment.md): vacancies, their approval and the stages. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { RecruitmentNotices, StageKind } from './recruitment';

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
      ? { opensOn: str(fd, 'opensOn'), closesOn: str(fd, 'closesOn') }
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
  await act(fd, 'publish', 'Published for the dates given.');
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
