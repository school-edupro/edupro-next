'use server';
/**
 * Appointment server actions (0059). The queue and ticket forms post here and come back with ?ok / ?error;
 * the set-up screen calls the save actions directly and shows the result in place.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { AppointmentSettings, AppointmentSetup, HostHours } from './appointments';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const BASE = '/engagement/appointments';

function detailOf(error: ApiError): string {
  const errs = error.problem.errors as
    Array<{ path?: string; message?: string }> | Record<string, string> | undefined;
  return Array.isArray(errs)
    ? errs.map((e) => [e.path, e.message].filter(Boolean).join(': ')).join('; ')
    : errs && typeof errs === 'object'
      ? Object.values(errs).join('; ')
      : (error.problem.detail ?? '');
}

function back(path: string, error: unknown): never {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
    );
  throw error;
}

/** Where a form came from (only our own pages). */
function returnTo(fd: FormData, fallback: string): string {
  const v = str(fd, 'returnTo');
  return v.startsWith(BASE) && !v.includes('//') ? v : fallback;
}

async function act(fd: FormData, verb: string, body: Record<string, unknown>, ok: string) {
  const id = str(fd, 'id');
  const here = returnTo(fd, `${BASE}/${id}`);
  try {
    await apiFetch(`/appointments/${id}/${verb}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${here}${here.includes('?') ? '&' : '?'}ok=${ok}`);
}

export async function approveAppointment(fd: FormData) {
  await act(
    fd,
    'approve',
    { note: str(fd, 'note') || undefined, location: str(fd, 'location') || undefined },
    'approved',
  );
}

export async function rejectAppointment(fd: FormData) {
  await act(fd, 'reject', { reason: str(fd, 'reason') }, 'rejected');
}

export async function rescheduleAppointment(fd: FormData) {
  await act(
    fd,
    'reschedule',
    {
      startsAt: str(fd, 'startsAt'),
      hostId: str(fd, 'hostId') || undefined,
      reason: str(fd, 'reason') || undefined,
      location: str(fd, 'location') || undefined,
    },
    'rescheduled',
  );
}

export async function cancelAppointment(fd: FormData) {
  await act(fd, 'cancel', { reason: str(fd, 'reason') || undefined }, 'cancelled');
}

export async function checkInAppointment(fd: FormData) {
  await act(fd, 'check-in', { badgeNo: str(fd, 'badgeNo') || undefined }, 'checked_in');
}

export async function checkOutAppointment(fd: FormData) {
  await act(fd, 'check-out', {}, 'checked_out');
}

export async function noShowAppointment(fd: FormData) {
  await act(fd, 'no-show', {}, 'no_show');
}

/** The gate looks a pass up; the code (or a mobile) stays out of the address bar. */
export async function findAtGate(fd: FormData) {
  const here = `${BASE}/gate`;
  const code = str(fd, 'code');
  if (code.length < 2) redirect(here);
  let ids: string[] = [];
  try {
    ids = (
      await apiFetch<{ data: Array<{ id: string }> }>('/appointments/gate/find', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
    ).data.map((a) => a.id);
  } catch (error) {
    back(here, error);
  }
  redirect(ids.length ? `${here}?found=${ids.join(',')}` : `${here}?found=none`);
}

/** The front desk books for a walk-in, a caller or about a pupil. */
export async function bookAppointment(fd: FormData) {
  const here = returnTo(fd, `${BASE}/new`);
  let id = '';
  try {
    id = (
      await apiFetch<{ id: string }>('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          hostId: str(fd, 'hostId'),
          startsAt: str(fd, 'startsAt'),
          purpose: str(fd, 'purpose'),
          studentId: str(fd, 'studentId') || undefined,
          visitorName: str(fd, 'visitorName') || undefined,
          visitorMobile: str(fd, 'visitorMobile') || undefined,
          visitorEmail: str(fd, 'visitorEmail') || undefined,
          visitorOrg: str(fd, 'visitorOrg') || undefined,
          partySize: Number(str(fd, 'partySize') || 1),
          idProofKind: str(fd, 'idProofKind') || undefined,
          idProofLast4: str(fd, 'idProofLast4') || undefined,
          approve: str(fd, 'approve') !== 'no',
        }),
      })
    ).id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}?ok=booked`);
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
async function result(fn: () => Promise<unknown>): Promise<Result<AppointmentSetup>> {
  try {
    await fn();
    revalidatePath(`${BASE}/setup`);
    return { ok: true, data: await apiFetch<AppointmentSetup>('/appointments/setup') };
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: detailOf(error) || error.problem.type };
    throw error;
  }
}

export async function saveAppointmentSettings(s: AppointmentSettings) {
  return result(() =>
    apiFetch('/appointments/setup/settings', { method: 'PUT', body: JSON.stringify(s) }),
  );
}

export interface HostInput {
  name: string;
  kind: 'desk' | 'person' | 'class_teacher';
  employeeId: string | null;
  location: string | null;
  openPublic: boolean;
  openParent: boolean;
  slotMinutes: number;
  capacity: number;
  sortOrder: number;
  status: 'active' | 'inactive';
  hours: HostHours[];
}

export async function saveAppointmentHost(id: string | null, h: HostInput) {
  return result(() =>
    apiFetch(id ? `/appointments/setup/hosts/${id}` : '/appointments/setup/hosts', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...h,
        // a desk may name its person in charge (0067); only the class-teacher entry has nobody fixed
        employeeId: h.kind === 'class_teacher' ? null : h.employeeId,
        openPublic: h.kind === 'class_teacher' ? false : h.openPublic,
      }),
    }),
  );
}
