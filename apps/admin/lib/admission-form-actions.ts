'use server';
/** Admission form builder actions (docs/design/39, part 1). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdmissionFormDef } from '@edupro/ui';
import { ApiError, apiFetch } from './api';

type Out<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function problem(e: unknown): { ok: false; error: string } {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<string | { message?: string }> | undefined;
    const msgs = Array.isArray(list)
      ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).filter(Boolean)
      : [];
    return {
      ok: false,
      error: msgs.length ? msgs.join('. ') : (e.problem.detail ?? e.problem.type),
    };
  }
  throw e;
}

/**
 * Saves the builder. `baseUpdatedAt` is the version the builder opened: when someone saved in between,
 * nothing is written and `stale` says who and when, so the builder can ask before replacing it.
 */
export async function saveAdmissionForm(
  id: string,
  input: { name: string; description: string; def: AdmissionFormDef; baseUpdatedAt?: string },
): Promise<
  | Out<{ id: string; updatedAt: string }>
  | { ok: false; error: string; stale: { updatedAt: string; updatedBy: string | null } }
> {
  if (!okId(id)) return { ok: false, error: 'Unknown form' };
  try {
    const r = await apiFetch<{ id: string; updatedAt: string }>(`/admissions/forms/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, description: input.description || undefined }),
    });
    revalidatePath('/admissions/forms');
    return { ok: true, data: { id: r.id, updatedAt: r.updatedAt } };
  } catch (e) {
    if (e instanceof ApiError && e.problem.type.endsWith('stale'))
      return {
        ok: false,
        error: e.problem.detail ?? 'This form was changed after you opened it',
        stale: {
          updatedAt: String(e.problem.updatedAt),
          updatedBy: (e.problem.updatedBy as string | null) ?? null,
        },
      };
    return problem(e);
  }
}

/** New form (from a ready form or blank), then open it in the builder. */
export async function createAdmissionForm(fd: FormData) {
  const template = str(fd, 'template');
  const name = str(fd, 'name');
  let id = '';
  try {
    const blank: AdmissionFormDef = {
      steps: [{ key: 'student', title: 'Student Details' }],
      fields: [],
      settings: { upperCase: true, maxFileMb: 10 },
    };
    const r = await apiFetch<{ id: string }>('/admissions/forms', {
      method: 'POST',
      body: JSON.stringify(
        template && template !== 'blank' ? { name, template } : { name, def: blank },
      ),
    });
    id = r.id;
  } catch (e) {
    const p = problem(e);
    redirect(`/admissions/forms?error=form&detail=${encodeURIComponent(p.error.slice(0, 300))}`);
  }
  redirect(`/admissions/forms/${id}?ok=1&detail=${encodeURIComponent('Form created')}`);
}

export async function copyAdmissionForm(fd: FormData) {
  const id = str(fd, 'id');
  let next = '';
  try {
    if (!okId(id)) throw new Error('Unknown form');
    const r = await apiFetch<{ id: string }>(`/admissions/forms/${id}/copy`, {
      method: 'POST',
      body: JSON.stringify({ name: str(fd, 'name') }),
    });
    next = r.id;
  } catch (e) {
    const p = problem(e);
    redirect(`/admissions/forms?error=form&detail=${encodeURIComponent(p.error.slice(0, 300))}`);
  }
  redirect(`/admissions/forms/${next}?ok=1&detail=${encodeURIComponent('Form copied')}`);
}

export async function setAdmissionFormStatus(fd: FormData) {
  const id = str(fd, 'id');
  const to = str(fd, 'to') === 'archive' ? 'archive' : 'restore';
  try {
    if (!okId(id)) throw new Error('Unknown form');
    await apiFetch(`/admissions/forms/${id}/${to}`, { method: 'POST' });
  } catch (e) {
    const p = problem(e);
    redirect(`/admissions/forms?error=form&detail=${encodeURIComponent(p.error.slice(0, 300))}`);
  }
  revalidatePath('/admissions/forms');
  redirect(
    `/admissions/forms?ok=1&r=${Date.now().toString(36)}&detail=${encodeURIComponent(to === 'archive' ? 'Form archived' : 'Form restored')}`,
  );
}
