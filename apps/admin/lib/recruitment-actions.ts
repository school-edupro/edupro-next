'use server';
/** Recruitment, part 1 (docs/design/34-recruitment.md): vacancies, their approval and the stages. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { StageKind } from './recruitment';

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
