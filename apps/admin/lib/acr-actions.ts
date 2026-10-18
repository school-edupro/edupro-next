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
