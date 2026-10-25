'use server';
/** The enquiry desk (docs/design/39, part 8). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { EnquiryStage } from './admission-enquiry';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

const body = (fd: FormData) => ({
  parentName: str(fd, 'parentName'),
  childName: opt(fd, 'childName'),
  childDob: opt(fd, 'childDob'),
  classId: opt(fd, 'classId'),
  cycleId: opt(fd, 'cycleId'),
  sourceId: opt(fd, 'sourceId'),
  campaign: opt(fd, 'campaign'),
  mobile: opt(fd, 'mobile')?.replace(/\D/g, '') || null,
  email: opt(fd, 'email'),
  locality: opt(fd, 'locality'),
  previousSchool: opt(fd, 'previousSchool'),
  notes: opt(fd, 'notes'),
  counsellorUserId: opt(fd, 'counsellorUserId'),
  nextFollowUpOn: opt(fd, 'nextFollowUpOn'),
});
const fail = (where: string, e: unknown): never => {
  if (e instanceof ApiError) {
    const list = e.problem.errors as Array<string | { message?: string }> | undefined;
    const msg =
      Array.isArray(list) && list.length
        ? list.map((x) => (typeof x === 'string' ? x : (x.message ?? ''))).join('. ')
        : (e.problem.detail ?? '');
    redirect(
      `${where}${where.includes('?') ? '&' : '?'}error=${encodeURIComponent(e.problem.type)}&detail=${encodeURIComponent(msg.slice(0, 200))}`,
    );
  }
  throw e;
};

export async function createEnquiry(fd: FormData) {
  let id: string;
  try {
    id = (
      await apiFetch<{ id: string }>('/admissions/enquiries', {
        method: 'POST',
        body: JSON.stringify(body(fd)),
      })
    ).id;
  } catch (e) {
    fail('/admissions/enquiries/new', e);
    return;
  }
  revalidatePath('/admissions/enquiries');
  redirect(`/admissions/enquiries/${id}?ok=1&detail=${encodeURIComponent('Enquiry saved.')}`);
}

export async function updateEnquiry(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/admissions/enquiries');
  try {
    await apiFetch(`/admissions/enquiries/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...body(fd),
        ...(opt(fd, 'status') ? { status: str(fd, 'status') } : {}),
      }),
    });
  } catch (e) {
    fail(`/admissions/enquiries/${id}`, e);
  }
  revalidatePath(`/admissions/enquiries/${id}`);
  redirect(`/admissions/enquiries/${id}?ok=1&detail=${encodeURIComponent('Saved.')}`);
}

export async function addFollowUp(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/admissions/enquiries');
  try {
    await apiFetch(`/admissions/enquiries/${id}/followups`, {
      method: 'POST',
      body: JSON.stringify({
        mode: str(fd, 'mode') || 'call',
        outcome: str(fd, 'outcome'),
        nextOn: opt(fd, 'nextOn'),
        ...(opt(fd, 'status') ? { status: str(fd, 'status') } : {}),
      }),
    });
  } catch (e) {
    fail(`/admissions/enquiries/${id}`, e);
  }
  revalidatePath(`/admissions/enquiries/${id}`);
  redirect(`/admissions/enquiries/${id}?ok=1&detail=${encodeURIComponent('Follow-up saved.')}`);
}

export async function inviteEnquiry(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/admissions/enquiries');
  let sent = 0;
  try {
    sent = (
      await apiFetch<{ sent: number }>(`/admissions/enquiries/${id}/invite`, {
        method: 'POST',
        body: JSON.stringify({
          ...(opt(fd, 'cycleId') ? { cycleId: str(fd, 'cycleId') } : {}),
          ...(opt(fd, 'message') ? { message: str(fd, 'message') } : {}),
        }),
      })
    ).sent;
  } catch (e) {
    fail(`/admissions/enquiries/${id}`, e);
  }
  revalidatePath(`/admissions/enquiries/${id}`);
  redirect(
    `/admissions/enquiries/${id}?ok=1&detail=${encodeURIComponent(`Invitation sent (${String(sent)} message${sent === 1 ? '' : 's'}).`)}`,
  );
}

/** A reply to the family by email and / or SMS (docs/design/43, part 3). */
export async function replyEnquiry(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) redirect('/admissions/enquiries');
  let sent = 0;
  try {
    sent = (
      await apiFetch<{ sent: number }>(`/admissions/enquiries/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          message: str(fd, 'message'),
          email: fd.get('byEmail') !== null,
          mobile: fd.get('byMobile') !== null,
        }),
      })
    ).sent;
  } catch (e) {
    fail(`/admissions/enquiries/${id}`, e);
  }
  revalidatePath(`/admissions/enquiries/${id}`);
  redirect(
    `/admissions/enquiries/${id}?ok=1&detail=${encodeURIComponent(`Reply sent (${String(sent)} message${sent === 1 ? '' : 's'}).`)}`,
  );
}

/** How website enquiries are taken: assigned on arrival (to whom), acknowledged. */
export async function saveEnquiryDesk(desk: {
  autoAssign: boolean;
  counsellors: string[];
  acknowledge: boolean;
}) {
  try {
    await apiFetch('/admissions/enquiries/desk', { method: 'PUT', body: JSON.stringify(desk) });
    revalidatePath('/admissions/setup');
    return { ok: true as const };
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false as const, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}

const said = (e: unknown) => {
  if (e instanceof ApiError)
    return { ok: false as const, error: e.problem.detail ?? e.problem.type };
  throw e;
};

/** A lead moved to a stage (Lost with its reason) from the board or its page (docs/design/45). */
export async function moveLead(id: string, stageId: string, lostReason?: string) {
  if (!okId(id) || !okId(stageId)) return { ok: false as const, error: 'Unknown lead' };
  try {
    await apiFetch(`/admissions/enquiries/${id}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stageId, ...(lostReason ? { lostReason } : {}) }),
    });
    revalidatePath('/admissions/enquiries');
    revalidatePath(`/admissions/enquiries/${id}`);
    return { ok: true as const };
  } catch (e) {
    return said(e);
  }
}

/** Many leads at once: given to a counsellor, moved, scored. */
export async function bulkLeads(dto: {
  ids: string[];
  counsellorUserId?: string | null;
  stageId?: string;
  lostReason?: string;
  score?: string;
}) {
  try {
    const r = await apiFetch<{ done: number; skipped: number }>('/admissions/enquiries/bulk', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    revalidatePath('/admissions/enquiries');
    return { ok: true as const, ...r };
  } catch (e) {
    return said(e);
  }
}

/** Enquiries from an Excel sheet (the format's columns); duplicates left out. */
export async function importEnquiries(fileBase64: string) {
  try {
    const r = await apiFetch<{
      added: number;
      duplicates: Array<{ row: number; message: string }>;
      errors: Array<{ row: number; message: string }>;
    }>('/admissions/enquiries/import', { method: 'POST', body: JSON.stringify({ fileBase64 }) });
    revalidatePath('/admissions/enquiries');
    return { ok: true as const, ...r };
  } catch (e) {
    return said(e);
  }
}

/** The school's stages of a lead (docs/design/45, part 1). */
export async function saveEnquiryStages(
  stages: Array<{ id?: string; name: string; kind: string; status: string }>,
) {
  try {
    const data = await apiFetch<EnquiryStage[]>('/admissions/enquiries/stages', {
      method: 'PUT',
      body: JSON.stringify({ stages }),
    });
    revalidatePath('/admissions/setup');
    revalidatePath('/admissions/enquiries');
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false as const, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}

export async function saveEnquirySources(
  sources: Array<{ id?: string; name: string; status: 'active' | 'inactive' }>,
) {
  try {
    const data = await apiFetch<Array<{ id: string; name: string; status: string; used: number }>>(
      '/admissions/enquiries/sources',
      {
        method: 'PUT',
        body: JSON.stringify({ sources }),
      },
    );
    revalidatePath('/admissions/setup');
    return { ok: true as const, data };
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false as const, error: e.problem.detail ?? e.problem.type };
    throw e;
  }
}
