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

/** Re-issue with today's settings: a new certificate printed as things are now; the earlier one cancelled. */
export async function reissueCertificate(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  let made: { id: string };
  try {
    made = await apiFetch<{ id: string }>(`/certificates/${id}/reissue`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (e) {
    // carrying over a principal's reason asks for a fresh sign-in first, as at issue
    if (e instanceof ApiError && e.problem.type === 'mfa-required')
      redirect(`/step-up?returnTo=${encodeURIComponent(`/certificates/${id}?open=actions`)}`);
    if (e instanceof ApiError) back(`/certificates/${id}`, e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(`/certificates/${made.id}?ok=reissued`);
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

// ---- phase E: bulk, awards ------------------------------------------------------------------------------------------
/** Bulk issue from the preview's form: then the batch's page. */
export async function bulkIssueCertificates(fd: FormData) {
  const type = str(fd, 'type');
  const section = str(fd, 'section');
  const leavers = str(fd, 'scope') === 'leavers';
  const here = `/certificates/bulk?${new URLSearchParams({ type, ...(leavers ? { scope: 'leavers' } : { section }) }).toString()}`;
  const fields: Record<string, string | number> = {};
  for (const [k, v] of fd.entries())
    if (k.startsWith(FIELD_PREFIX) && typeof v === 'string' && v.trim())
      fields[k.slice(FIELD_PREFIX.length)] = v.trim();
  let batch: { id: string };
  try {
    batch = await apiFetch<{ id: string }>('/certificates/bulk/issue', {
      method: 'POST',
      body: JSON.stringify({
        typeCode: type,
        ...(leavers ? { leavers: true } : { sectionId: section }),
        purpose: str(fd, 'purpose') || undefined,
        issuedOn: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'issuedOn')) ? str(fd, 'issuedOn') : undefined,
        fields,
        overrideReason: str(fd, 'overrideReason') || undefined,
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(`/certificates/batches/${batch.id}?ok=issued`);
}

export async function saveAward(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(okId(id) ? `/certificates/awards/${id}` : '/certificates/awards', {
      method: okId(id) ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: str(fd, 'name'),
        typeCode: str(fd, 'typeCode'),
        description: str(fd, 'description') || undefined,
        active: okId(id) ? fd.get('active') !== null : true,
        sortOrder: Math.min(9999, Math.max(0, Number(str(fd, 'sortOrder')) || 100)),
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/certificates/awards', e);
    throw e;
  }
  revalidatePath('/certificates/awards');
  redirect('/certificates/awards?ok=award');
}

/** One allotment: the student found by admission no. */
export async function addAllotment(fd: FormData) {
  const no = str(fd, 'admissionNo');
  try {
    const hits = await apiFetch<{ rows: Array<{ id: string; admissionNo: string }> }>(
      `/certificates/students?q=${encodeURIComponent(no)}`,
    );
    const s = hits.rows.find((h) => h.admissionNo.toLowerCase() === no.toLowerCase());
    if (!s)
      redirect(
        `/certificates/awards?error=not-found&detail=${encodeURIComponent(`No student with admission no. ${no}`)}`,
      );
    await apiFetch('/certificates/allotments', {
      method: 'POST',
      body: JSON.stringify({
        awardId: str(fd, 'awardId'),
        studentId: s.id,
        event: str(fd, 'event') || undefined,
        position: str(fd, 'position') || undefined,
        awardedOn: str(fd, 'awardedOn'),
        remarks: str(fd, 'remarks') || undefined,
      }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/certificates/awards', e);
    throw e;
  }
  revalidatePath('/certificates/awards');
  redirect('/certificates/awards?ok=allotted');
}

/** Allotments from a CSV: checked first; saved when the check is clean and "save" is ticked. */
export async function importAllotments(fd: FormData) {
  const file = fd.get('file');
  const csv = file instanceof File ? await file.text() : '';
  const save = fd.get('save') !== null;
  let r: { rows: number; valid: number; errors: string[]; saved: number };
  try {
    r = await apiFetch('/certificates/allotments/import', {
      method: 'POST',
      body: JSON.stringify({ csv, dryRun: !save }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/certificates/awards', e);
    throw e;
  }
  const detail = r.errors.length
    ? `${String(r.errors.length)} problem(s), nothing saved: ${r.errors.slice(0, 5).join('; ')}`
    : r.saved
      ? `${String(r.saved)} saved`
      : `${String(r.valid)} row(s) are right: tick "Save them" and upload again`;
  redirect(
    `/certificates/awards?${r.errors.length ? 'error=validation-failed' : 'ok=imported'}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
  );
}

export async function issueAllotments(fd: FormData) {
  const ids = fd.getAll('allotment').map(String).filter(okId);
  if (!ids.length)
    redirect('/certificates/awards?error=validation-failed&detail=Tick+the+awards+to+issue');
  let r: { batches: Array<{ id: string }> };
  try {
    r = await apiFetch('/certificates/allotments/issue', {
      method: 'POST',
      body: JSON.stringify({ allotmentIds: ids }),
    });
  } catch (e) {
    if (e instanceof ApiError) back('/certificates/awards', e);
    throw e;
  }
  revalidatePath('/certificates');
  redirect(
    r.batches.length === 1
      ? `/certificates/batches/${r.batches[0]!.id}?ok=issued`
      : `/certificates/bulk?ok=batches&detail=${encodeURIComponent(`${String(r.batches.length)} batches made`)}`,
  );
}

export async function removeAllotment(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) return;
  try {
    await apiFetch(`/certificates/allotments/${id}/remove`, { method: 'POST' });
  } catch (e) {
    if (e instanceof ApiError) back('/certificates/awards', e);
    throw e;
  }
  revalidatePath('/certificates/awards');
  redirect('/certificates/awards?ok=removed');
}
