'use server';
/** Clinic management server actions (0075): set-up, stock, visits, check-up camps and cards. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ClinicSetup } from './clinic';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/engagement/clinic';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}
function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((detailOf(error) || error.problem.type).slice(0, 300))}`,
    );
  throw error;
}
function returnTo(fd: FormData, fallback: string): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : fallback;
}
const withOk = (path: string, ok: string) => `${path}${path.includes('?') ? '&' : '?'}ok=${ok}`;
export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
async function result<T>(fn: () => Promise<T>): Promise<Result<{ data: T }>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

// ---- set-up (client component) ------------------------------------------------------------------------
export async function saveClinicMaster(id: string | null, body: Record<string, unknown>) {
  const r = await result(() =>
    apiFetch<ClinicSetup>(id ? `/clinic/setup/masters/${id}` : '/clinic/setup/masters', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),
  );
  revalidatePath(`${BASE}/setup`);
  return r;
}
export async function saveClinicMedicine(id: string | null, body: Record<string, unknown>) {
  const r = await result(() =>
    apiFetch<ClinicSetup>(id ? `/clinic/setup/medicines/${id}` : '/clinic/setup/medicines', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),
  );
  revalidatePath(`${BASE}/setup`);
  return r;
}
export async function saveClinicSettings(body: Record<string, unknown>) {
  const r = await result(() =>
    apiFetch<ClinicSetup>('/clinic/setup/settings', { method: 'PUT', body: JSON.stringify(body) }),
  );
  revalidatePath(`${BASE}/setup`);
  return r;
}

// ---- visits -------------------------------------------------------------------------------------------
/** Pupils or staff for the visit form (the search is posted, never in the address bar). */
export async function findClinicPeople(audience: 'student' | 'staff', q: string) {
  return result(() =>
    apiFetch<{
      data: Array<{
        id: string;
        name: string;
        code: string | null;
        detail: string | null;
        bloodGroup: string | null;
        visits90: number;
      }>;
    }>(`/clinic/people?${new URLSearchParams({ audience, q }).toString()}`),
  );
}
export async function createClinicVisit(body: Record<string, unknown>) {
  const r = await result(() =>
    apiFetch<{ id: string; number: string; notified: number }>('/clinic/visits', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  revalidatePath(BASE);
  return r;
}
export async function closeClinicVisit(fd: FormData) {
  const here = returnTo(fd, `${BASE}/visits`);
  try {
    await apiFetch(`/clinic/visits/${str(fd, 'id')}/out`, { method: 'POST', body: '{}' });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'closed'));
}

// ---- stock --------------------------------------------------------------------------------------------
export async function receiveClinicStock(fd: FormData) {
  const here = `${BASE}/stock?view=batches`;
  try {
    await apiFetch('/clinic/stock', {
      method: 'POST',
      body: JSON.stringify({
        medicineId: str(fd, 'medicineId'),
        qty: Number(str(fd, 'qty')),
        batchNo: str(fd, 'batchNo') || undefined,
        expiryOn: str(fd, 'expiryOn') || undefined,
        receivedOn: str(fd, 'receivedOn') || undefined,
        supplier: str(fd, 'supplier') || undefined,
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'received'));
}
export async function writeOffClinicStock(fd: FormData) {
  const here = returnTo(fd, `${BASE}/stock?view=batches`);
  try {
    await apiFetch('/clinic/stock/write-off', {
      method: 'POST',
      body: JSON.stringify({
        stockId: str(fd, 'stockId'),
        qty: Number(str(fd, 'qty')),
        note: str(fd, 'note'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'written_off'));
}

// ---- check-up camps -----------------------------------------------------------------------------------
export async function saveHealthCamp(fd: FormData) {
  const id = str(fd, 'id');
  const here = id ? `${BASE}/checkups/${id}` : `${BASE}/checkups`;
  let out = id;
  try {
    out = (
      await apiFetch<{ id: string }>(id ? `/clinic/camps/${id}` : '/clinic/camps', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: str(fd, 'name'),
          startsOn: str(fd, 'startsOn'),
          endsOn: str(fd, 'endsOn') || undefined,
          doctorId: str(fd, 'doctorId') || undefined,
          place: str(fd, 'place') || undefined,
          status: str(fd, 'status') === 'closed' ? 'closed' : 'open',
        }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(withOk(`${BASE}/checkups/${out}`, 'saved'));
}
export async function saveHealthCheckup(fd: FormData) {
  const camp = str(fd, 'campId');
  const section = str(fd, 'sectionId');
  const student = str(fd, 'studentId');
  const sheet = `${BASE}/checkups/${camp}/${section}`;
  const findings: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (k.startsWith('f.') && String(v).trim()) findings[k.slice(2)] = String(v).trim();
  try {
    await apiFetch(`/clinic/camps/${camp}/students/${student}`, {
      method: 'PUT',
      body: JSON.stringify({
        examDate: str(fd, 'examDate') || undefined,
        doctorId: str(fd, 'doctorId') || undefined,
        place: str(fd, 'place') || undefined,
        heightCm: str(fd, 'heightCm') || undefined,
        weightKg: str(fd, 'weightKg') || undefined,
        bloodGroup: str(fd, 'bloodGroup') || undefined,
        findings,
        diseaseId: str(fd, 'diseaseId') || undefined,
        description: str(fd, 'description') || undefined,
        remarks: str(fd, 'remarks') || undefined,
        needsAttention: fd.get('needsAttention') !== null,
      }),
    });
  } catch (error) {
    back(`${sheet}?student=${student}`, error);
  }
  revalidatePath(BASE);
  // on to the next pupil of the class when there is one
  const next = str(fd, 'nextStudentId');
  redirect(withOk(next ? `${sheet}?student=${next}` : sheet, 'saved'));
}
export async function publishHealthCards(fd: FormData) {
  const sheet = `${BASE}/checkups/${str(fd, 'campId')}/${str(fd, 'sectionId')}`;
  let n = 0;
  try {
    n = (
      await apiFetch<{ published: number }>(
        `/clinic/camps/${str(fd, 'campId')}/sections/${str(fd, 'sectionId')}/publish`,
        { method: 'POST', body: '{}' },
      )
    ).published;
  } catch (error) {
    back(sheet, error);
  }
  revalidatePath(BASE);
  redirect(`${sheet}?ok=published&n=${String(n)}`);
}

// ---- set-up lists: add / edit from a plain form, upload from Excel ------------------------------------
const SETUP = `${BASE}/setup`;
export async function saveClinicEntry(fd: FormData) {
  const kind = str(fd, 'kind');
  const id = str(fd, 'id');
  const here = `${SETUP}?tab=${kind}`;
  const active = fd.get('active') !== null;
  try {
    if (kind === 'medicine')
      await apiFetch(id ? `/clinic/setup/medicines/${id}` : '/clinic/setup/medicines', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: str(fd, 'name'),
          form: str(fd, 'form') || 'Tablet',
          strength: str(fd, 'strength'),
          unit: str(fd, 'unit') || 'tablet',
          lowStockAt: Number(str(fd, 'lowStockAt') || 10),
          active,
        }),
      });
    else
      await apiFetch(id ? `/clinic/setup/masters/${id}` : '/clinic/setup/masters', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify({
          kind,
          name: str(fd, 'name'),
          qualification: str(fd, 'qualification'),
          regNo: str(fd, 'regNo'),
          mobile: str(fd, 'mobile'),
          employeeId: str(fd, 'employeeId'),
          note: str(fd, 'note'),
          active,
          sortOrder: Number(str(fd, 'sortOrder') || 0),
        }),
      });
  } catch (error) {
    back(id ? `${here}&edit=${id}` : `${here}&add=1`, error);
  }
  revalidatePath(BASE);
  redirect(withOk(here, 'saved'));
}

/** An Excel file from the browser goes to the API as base64; the answer says what went in and what did not. */
async function upload(fd: FormData, kind: string, url: string, here: string) {
  const f = fd.get('file');
  if (!(f instanceof File) || f.size === 0)
    redirect(
      `${here}${here.includes('?') ? '&' : '?'}error=validation-failed&detail=${encodeURIComponent('Choose the Excel file first.')}`,
    );
  if (f.size > 700_000)
    redirect(
      `${here}${here.includes('?') ? '&' : '?'}error=validation-failed&detail=${encodeURIComponent('The file is too large (700 KB at most). Split it into smaller files.')}`,
    );
  let out: {
    rows: number;
    added: number;
    updated: number;
    errors: Array<{ row: number; message: string }>;
  };
  try {
    out = await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify({
        kind,
        fileBase64: Buffer.from(await f.arrayBuffer()).toString('base64'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  const bad = out.errors
    .slice(0, 8)
    .map((e) => `row ${String(e.row)}: ${e.message}`)
    .join(' | ');
  redirect(
    `${here}${here.includes('?') ? '&' : '?'}ok=imported&added=${String(out.added)}&updated=${String(out.updated)}&failed=${String(out.errors.length)}${bad ? `&bad=${encodeURIComponent(bad.slice(0, 600))}` : ''}`,
  );
}
export async function importClinicSetup(fd: FormData) {
  const kind = str(fd, 'kind');
  await upload(fd, kind, '/clinic/setup/import', `${SETUP}?tab=${kind}`);
}
export async function importClinicStock(fd: FormData) {
  await upload(fd, 'stock', '/clinic/stock/import', `${BASE}/stock?view=batches`);
}

export async function saveCheckupField(id: string | null, body: Record<string, unknown>) {
  const r = await result(() =>
    apiFetch<ClinicSetup>(id ? `/clinic/setup/fields/${id}` : '/clinic/setup/fields', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),
  );
  revalidatePath(`${BASE}/setup`);
  return r;
}
