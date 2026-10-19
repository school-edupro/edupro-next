'use server';
/** Employee ACR set-up (docs/design/32-employee-acr.md). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { AcrBand, AcrLevel, StaffGroup } from './acr';

const SETUP = '/people/acr/setup';
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

/** Rating words, days to object and the grade bands (from the client editor). */
export async function saveAcrSettings(input: {
  scaleLabels: string[];
  representationDays: number;
  staffLateAfter: string;
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
        })),
      }),
    });
  } catch (e) {
    return problem(e);
  }
  revalidatePath(SETUP);
  return { ok: true };
}

/** Add or change a question (form). */
export async function saveAcrQuestion(fd: FormData) {
  const id = str(fd, 'id');
  const part = str(fd, 'part') === 'rate' ? 'rate' : 'self';
  const back_ = `${SETUP}?tab=questions&part=${part}`;
  try {
    await apiFetch(okId(id) ? `${SETUP}/questions/${id}` : `${SETUP}/questions`, {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        part,
        staffGroup: str(fd, 'staffGroup'),
        section: str(fd, 'section'),
        text: str(fd, 'text'),
        kind: str(fd, 'kind') === 'text' ? 'text' : 'scale',
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

/** Switch a question on or off (form). */
export async function toggleAcrQuestion(fd: FormData) {
  const id = str(fd, 'id');
  const part = str(fd, 'part') === 'rate' ? 'rate' : 'self';
  const back_ = `${SETUP}?tab=questions&part=${part}`;
  if (!okId(id)) redirect(back_);
  try {
    const q = JSON.parse(str(fd, 'q')) as Record<string, unknown>;
    await apiFetch(`${SETUP}/questions/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...q, active: str(fd, 'active') === 'true' }),
    });
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
type AnswerMap = Record<string, number | string>;
interface LevelBody {
  answers: AnswerMap;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
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
