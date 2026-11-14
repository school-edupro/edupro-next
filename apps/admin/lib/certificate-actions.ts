'use server';
/** Certificate register (docs/design/87): issue, duplicate, cancel, make the PDF again. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import { FIELD_PREFIX, type Certificate } from './certificates';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const detailOf = (e: ApiError) => {
  const errors = e.problem.errors as
    Record<string, string> | Array<{ message?: string }> | undefined;
  const first = Array.isArray(errors)
    ? errors.map((x) => x.message).find(Boolean)
    : errors
      ? Object.values(errors)[0]
      : undefined;
  return e.problem.detail ?? first ?? e.problem.type;
};
const back = (path: string, error: ApiError): never =>
  redirect(
    `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
  );

/** The issue form as the API takes it: the type, the student, the purpose, the typed fields, an override reason. */
function issueBody(fd: FormData) {
  const fields: Record<string, string | number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith(FIELD_PREFIX) || typeof v !== 'string') continue;
    const key = k.slice(FIELD_PREFIX.length);
    if (!/^[a-zA-Z]{2,30}$/.test(key)) continue;
    const t = v.trim();
    fields[key] = fd.get(`num_${key}`) === '1' && /^\d{1,4}$/.test(t) ? Number(t) : t;
  }
  return {
    typeCode: str(fd, 'type'),
    studentId: str(fd, 'student'),
    purpose: str(fd, 'purpose') || undefined,
    issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'issuedOn')) ? str(fd, 'issuedOn') : undefined,
    fields,
    overrideReason: str(fd, 'overrideReason') || undefined,
  };
}

export async function issueCertificate(fd: FormData) {
  const body = issueBody(fd);
  const here = `/certificates/issue?type=${encodeURIComponent(body.typeCode)}&student=${encodeURIComponent(body.studentId)}`;
  if (!okId(body.studentId))
    redirect('/certificates/issue?error=validation-failed&detail=Choose+a+student');
  let made: Certificate;
  try {
    made = await apiFetch<Certificate>('/certificates/issue', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(`/certificates/${made.id}?ok=issued`);
}

export async function duplicateCertificate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  let made: Certificate;
  try {
    made = await apiFetch<Certificate>(`/certificates/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/certificates/${id}`, e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(`/certificates/${made.id}?ok=duplicated`);
}

export async function cancelCertificate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  try {
    await apiFetch(`/certificates/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/certificates/${id}`, e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(`/certificates/${id}?ok=cancelled`);
}

export async function renderCertificate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  try {
    await apiFetch(`/certificates/${id}/render`, { method: 'POST' });
  } catch (e) {
    if (e instanceof ApiError) back(`/certificates/${id}`, e);
    throw e;
  }
  redirect(`/certificates/${id}?ok=rendered`);
}
