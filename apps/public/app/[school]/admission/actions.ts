'use server';
import { redirect } from 'next/navigation';
import type { AdmissionAnswers } from '@edupro/ui';
import { PublicApiError } from '@/lib/api';
import { admissionFetch } from '@/lib/admission';

type Result = { ok: boolean; errors?: Record<string, string>; message?: string };

const fail = (error: unknown): Result => {
  if (error instanceof PublicApiError) {
    const p = error.problem as { detail?: string; type: string; errors?: Record<string, string> };
    if (error.status === 401)
      return {
        ok: false,
        message: 'Your sign-in has ended: sign in again to go on (your saved tabs are kept).',
      };
    return { ok: false, errors: p.errors, message: p.detail ?? p.type };
  }
  throw error;
};

/** A new registration for a class of an open session, then its form. */
export async function startRegistration(fd: FormData) {
  const school = String(fd.get('school') ?? '').toLowerCase();
  const cycleId = String(fd.get('cycleId') ?? '');
  const classId = String(fd.get('classId') ?? '');
  const enquiry = String(fd.get('enquiry') ?? '');
  // "Register another child": a new form even when the family has a draft for the class
  const another = fd.get('another') === '1';
  if (!/^[a-z0-9-]{2,20}$/.test(school)) redirect('/');
  let out: { id: string; resumed?: boolean };
  try {
    out = await admissionFetch<{ id: string; resumed?: boolean }>('/me/applications', {
      method: 'POST',
      body: JSON.stringify({
        cycleId,
        classId,
        ...(/^[A-Za-z0-9_-]{16,64}$/.test(enquiry) ? { enquiry } : {}),
        ...(another ? { another: true } : {}),
      }),
    });
  } catch (error) {
    const msg =
      error instanceof PublicApiError
        ? (error.problem.detail ?? error.problem.type)
        : 'Could not start';
    redirect(`/${school}/admission/apply?error=${encodeURIComponent(String(msg).slice(0, 160))}`);
  }
  redirect(`/${school}/admission/application/${out.id}${out.resumed ? '?resumed=1' : ''}`);
}

export async function saveAdmissionStep(
  id: string,
  answers: AdmissionAnswers,
  step: string,
): Promise<Result> {
  try {
    const out = await admissionFetch<{ errors: Record<string, string> }>(
      `/me/applications/${id}/step`,
      {
        method: 'PUT',
        body: JSON.stringify({ answers, step }),
      },
    );
    return Object.keys(out.errors ?? {}).length ? { ok: false, errors: out.errors } : { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function submitAdmission(id: string, answers: AdmissionAnswers): Promise<Result> {
  try {
    await admissionFetch(`/me/applications/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function lookupSibling(admissionNo: string) {
  try {
    const r = await admissionFetch<{ found?: boolean; name?: string; classSection?: string }>(
      `/me/sibling?admissionNo=${encodeURIComponent(admissionNo)}`,
    );
    return r.name ? { name: r.name, classSection: r.classSection ?? '' } : null;
  } catch {
    return null;
  }
}

export async function withdrawRegistration(fd: FormData) {
  const school = String(fd.get('school') ?? '').toLowerCase();
  const id = String(fd.get('id') ?? '');
  if (!/^[a-z0-9-]{2,20}$/.test(school) || !/^\d{1,18}$/.test(id)) redirect('/');
  await admissionFetch(`/me/applications/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  }).catch(() => undefined);
  redirect(`/${school}/admission/registrations`);
}

/**
 * A late-entry passcode from the school (docs/design/41, part 4): it opens the closed class for the
 * family, then their form for it (the draft they had, or a new one).
 */
export async function usePasscode(fd: FormData) {
  const school = String(fd.get('school') ?? '').toLowerCase();
  const code = String(fd.get('code') ?? '').trim();
  if (!/^[a-z0-9-]{2,20}$/.test(school)) redirect('/');
  let out: { id: string; resumed?: boolean };
  try {
    const p = await admissionFetch<{ cycleId: string; classId: string }>('/me/passcode', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    out = await admissionFetch<{ id: string; resumed?: boolean }>('/me/applications', {
      method: 'POST',
      body: JSON.stringify({ cycleId: p.cycleId, classId: p.classId }),
    });
  } catch (error) {
    const msg =
      error instanceof PublicApiError
        ? (error.problem.detail ?? error.problem.type)
        : 'Could not use the passcode';
    redirect(`/${school}/admission/apply?error=${encodeURIComponent(String(msg).slice(0, 200))}`);
  }
  redirect(`/${school}/admission/application/${out.id}`);
}

/** A notice or message the family opened (docs/design/42, part 4). */
export async function markInboxRead(kind: 'notice' | 'message', id: string) {
  if (!/^\d{1,18}$/.test(id)) return;
  await admissionFetch('/me/inbox/read', {
    method: 'POST',
    body: JSON.stringify({ items: [{ kind, id }] }),
  }).catch(() => undefined);
}

/** Every notice and message marked read, then back to Messages. */
export async function markAllInboxRead(fd: FormData) {
  const school = String(fd.get('school') ?? '').toLowerCase();
  if (!/^[a-z0-9-]{2,20}$/.test(school)) redirect('/');
  await admissionFetch('/me/inbox/read', {
    method: 'POST',
    body: JSON.stringify({ all: true }),
  }).catch(() => undefined);
  redirect(`/${school}/admission/messages`);
}
