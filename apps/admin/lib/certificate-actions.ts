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
  const employee = str(fd, 'employee');
  const variant = str(fd, 'variant');
  return {
    typeCode: str(fd, 'type'),
    ...(okId(employee) ? { employeeId: employee } : { studentId: str(fd, 'student') }),
    ...(okId(variant) ? { variant } : {}),
    ...(okId(str(fd, 'requestId')) ? { requestId: str(fd, 'requestId') } : {}),
    purpose: str(fd, 'purpose') || undefined,
    issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'issuedOn')) ? str(fd, 'issuedOn') : undefined,
    fields,
    overrideReason: str(fd, 'overrideReason') || undefined,
  };
}

export async function issueCertificate(fd: FormData) {
  const body = issueBody(fd);
  const person =
    'employeeId' in body ? `employee=${body.employeeId ?? ''}` : `student=${body.studentId ?? ''}`;
  const here = `/certificates/issue?type=${encodeURIComponent(body.typeCode)}&${person}${
    'requestId' in body && body.requestId ? `&request=${body.requestId}` : ''
  }`;
  if (!okId(('employeeId' in body ? body.employeeId : body.studentId) ?? ''))
    redirect('/certificates/issue?error=validation-failed&detail=Choose+the+person');
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

/** Approve or reject a request at the level the caller acts at. */
export async function decideCertificateRequest(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  const decision = str(fd, 'decision') === 'reject' ? 'reject' : 'approve';
  try {
    await apiFetch(`/certificate-requests/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: str(fd, 'reason') || undefined }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/certificates/requests/${id}`, e);
    throw e;
  }
  revalidatePath('/certificates/requests');
  redirect(`/certificates/requests/${id}?ok=${decision === 'approve' ? 'approved' : 'rejected'}`);
}

/** Take the fee off a request, or turn an approved request down. */
export async function closeCertificateRequestFee(fd: FormData) {
  const id = str(fd, 'id');
  const what = str(fd, 'what') === 'refuse' ? 'refuse' : 'waive-fee';
  if (!okId(id)) return;
  try {
    await apiFetch(`/certificate-requests/${id}/${what}`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(`/certificates/requests/${id}`, e);
    throw e;
  }
  revalidatePath('/certificates/requests');
  redirect(`/certificates/requests/${id}?ok=${what === 'refuse' ? 'refused' : 'waived'}`);
}
