'use server';
/** The school desk of online admission (docs/design/39, part 3). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdmissionAnswers } from '@edupro/ui';
import { ApiError, apiFetch } from './api';

type Result = { ok: boolean; errors?: Record<string, string>; message?: string; type?: string };
const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function fail(e: unknown): Result {
  if (e instanceof ApiError) {
    const errors = e.problem.errors;
    return {
      ok: false,
      errors:
        errors && !Array.isArray(errors) && typeof errors === 'object'
          ? (errors as Record<string, string>)
          : undefined,
      message: e.problem.detail ?? e.problem.type,
      type: e.problem.type,
    };
  }
  throw e;
}

/** A walk-in parent: a new registration form for the class, then its form. */
export async function startWalkIn(fd: FormData) {
  const [cycleId, classId] = str(fd, 'line').split(':');
  const mobile = str(fd, 'mobile').replace(/\D/g, '');
  const email = str(fd, 'email').toLowerCase();
  const parentName = str(fd, 'parentName');
  if (!cycleId || !classId || !okId(cycleId) || !okId(classId))
    redirect('/admissions/desk?error=validation-failed&detail=Choose+the+class');
  if (!mobile && !email)
    redirect('/admissions/desk?error=validation-failed&detail=Give+the+mobile+or+the+email');
  let id: string;
  try {
    id = (
      await apiFetch<{ id: string }>('/admissions/desk/applications', {
        method: 'POST',
        body: JSON.stringify({
          cycleId,
          classId,
          ...(mobile ? { mobile } : {}),
          ...(email ? { email } : {}),
          ...(parentName ? { parentName } : {}),
        }),
      })
    ).id;
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `/admissions/desk?error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(
          String(e.problem.detail ?? '').slice(0, 160),
        )}`,
      );
    throw e;
  }
  redirect(`/admissions/desk/${id}`);
}

export async function saveDeskStep(
  id: string,
  answers: AdmissionAnswers,
  step: string,
): Promise<Result> {
  if (!okId(id)) return { ok: false, message: 'Unknown form' };
  try {
    const out = await apiFetch<{ errors: Record<string, string> }>(
      `/admissions/applications/${id}/form/step`,
      { method: 'PUT', body: JSON.stringify({ answers, step }) },
    );
    return Object.keys(out.errors ?? {}).length ? { ok: false, errors: out.errors } : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function submitDeskForm(
  id: string,
  answers: AdmissionAnswers,
  duplicateReason?: string,
): Promise<Result> {
  if (!okId(id)) return { ok: false, message: 'Unknown form' };
  try {
    await apiFetch(`/admissions/applications/${id}/form/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, ...(duplicateReason ? { duplicateReason } : {}) }),
    });
    revalidatePath(`/admissions/desk/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The registration fee taken at the counter: a receipt in the fee module and the registration number. */
export async function collectRegistrationFee(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/admissions/desk');
  const mode = str(fd, 'mode');
  const reference = str(fd, 'reference');
  const instrumentNo = str(fd, 'instrumentNo');
  const bankName = str(fd, 'bankName');
  let out: { receiptNo: string; number: string };
  try {
    out = await apiFetch(`/admissions/applications/${id}/registration-fee`, {
      method: 'POST',
      body: JSON.stringify({
        mode,
        ...(reference ? { reference } : {}),
        ...(instrumentNo ? { instrumentNo } : {}),
        ...(bankName ? { bankName } : {}),
      }),
    });
  } catch (e) {
    if (e instanceof ApiError)
      redirect(
        `/admissions/desk/${id}?error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(
          String(e.problem.detail ?? '').slice(0, 160),
        )}`,
      );
    throw e;
  }
  revalidatePath(`/admissions/desk/${id}`);
  redirect(
    `/admissions/desk/${id}?ok=1&detail=${encodeURIComponent(`Receipt ${out.receiptNo}; registration no. ${out.number}`)}`,
  );
}

/** One upload of a form filled at the desk: a slot owned by the application, then the bytes. */
export async function uploadDeskFile(
  fd: FormData,
): Promise<
  { ok: true; fileId: string; name: string; contentType: string } | { ok: false; error: string }
> {
  const id = str(fd, 'id');
  const fieldKey = str(fd, 'fieldKey');
  const file = fd.get('file');
  if (!okId(id) || !(file instanceof File) || file.size === 0)
    return { ok: false, error: 'Choose a file' };
  try {
    const reg = await apiFetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>(`/admissions/applications/${id}/form/slot`, {
      method: 'POST',
      body: JSON.stringify({
        fieldKey,
        fileName: file.name.slice(0, 200) || 'file',
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
    const target = reg.upload.url.startsWith('http') ? reg.upload.url : `${API}${reg.upload.url}`;
    const headers = new Headers({ 'content-type': file.type });
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers.set(k, v);
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!put.ok) return { ok: false, error: `${file.name} did not upload; try again` };
    return { ok: true, fileId: reg.file.id, name: file.name, contentType: file.type };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}
