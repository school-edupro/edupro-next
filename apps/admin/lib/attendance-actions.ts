'use server';
/** Attendance (0083): bus roll marked from the ERP, the set-up, and reopening a day. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    // a refused field says what is wrong with it ("Write the reason for not approving")
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      error.problem.detail ||
      '';
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};

export async function markBusRoll(fd: FormData) {
  const routeId = str(fd, 'routeId');
  const trip = str(fd, 'trip') === 'drop' ? 'drop' : 'pick';
  const date = str(fd, 'date');
  const here = `/attendance/bus-roll?date=${date}&route=${routeId}&trip=${trip}`;
  const marks: Array<{ studentId: string; code: string; remarks?: string }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('code-') || typeof value !== 'string' || !value) continue;
    const studentId = key.slice(5);
    marks.push({ studentId, code: value, remarks: str(fd, `remarks-${studentId}`) || undefined });
  }
  try {
    await apiFetch('/attendance/bus-roll', {
      method: 'POST',
      body: JSON.stringify({ routeId, trip, date, marks }),
    });
  } catch (error) {
    fail(here, error);
  }
  revalidatePath('/attendance');
  redirect(`${here}&ok=saved`);
}

export type SetupResult = { ok: true } | { ok: false; error: string };
export async function saveAttendanceSetup(input: {
  classFrom: string;
  classTo: string;
  busPickFrom: string;
  busPickTo: string;
  busDropFrom: string;
  busDropTo: string;
  backDays: number;
}): Promise<SetupResult> {
  try {
    await apiFetch('/attendance/desk/setup', { method: 'PUT', body: JSON.stringify(input) });
    revalidatePath('/attendance/setup');
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const errs = error.problem.errors as Array<{ message?: string }> | undefined;
      return {
        ok: false,
        error:
          (Array.isArray(errs)
            ? errs
                .map((e) => e.message)
                .filter(Boolean)
                .join('; ')
            : '') ||
          error.problem.detail ||
          error.problem.type,
      };
    }
    throw error;
  }
}

export async function reopenAttendance(fd: FormData) {
  const here = '/attendance/setup';
  const target = str(fd, 'target'); // "class|<sectionId>" or "bus|<routeId>|<trip>"
  const [scope, id, trip] = target.split('|');
  try {
    await apiFetch('/attendance/desk/reopen', {
      method: 'POST',
      body: JSON.stringify({
        scope: scope === 'bus' ? 'bus' : 'class',
        classSectionId: scope === 'class' ? id : undefined,
        routeId: scope === 'bus' ? id : undefined,
        trip: scope === 'bus' ? trip : undefined,
        date: str(fd, 'date'),
        hours: Number(str(fd, 'hours')) || 4,
        reason: str(fd, 'reason'),
      }),
    });
  } catch (error) {
    fail(here, error);
  }
  revalidatePath(here);
  redirect(`${here}?ok=reopened`);
}

const said = (error: unknown): string => {
  if (!(error instanceof ApiError)) throw error;
  const errs = error.problem.errors as Array<{ message?: string }> | undefined;
  return (
    (Array.isArray(errs)
      ? errs
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ')
      : '') ||
    error.problem.detail ||
    error.problem.type
  );
};

export type RouteTeacherResult =
  | { ok: true; text: string; errors?: Array<{ row: number; message: string }> }
  | { ok: false; error: string };

/** A teacher on the routes picked, for the morning trip, the afternoon trip or both. */
export async function addRouteTeachers(input: {
  employeeId: string;
  routeIds: string[];
  trip: 'both' | 'pick' | 'drop';
}): Promise<RouteTeacherResult> {
  try {
    const r = await apiFetch<{ added: number; login: boolean }>('/attendance/desk/route-teachers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/attendance/setup');
    return {
      ok: true,
      text:
        (r.added ? 'Saved.' : 'Already mapped; nothing new to save.') +
        (r.login ? '' : ' This employee has no login yet, so cannot mark until one is given.'),
    };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}

export async function removeRouteTeacher(input: {
  employeeId: string;
  routeId: string;
  trip: 'both' | 'pick' | 'drop';
}): Promise<RouteTeacherResult> {
  try {
    await apiFetch('/attendance/desk/route-teachers/remove', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/attendance/setup');
    return { ok: true, text: 'Removed.' };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}

export async function importRouteTeachers(fileBase64: string): Promise<RouteTeacherResult> {
  try {
    const r = await apiFetch<{
      added: number;
      already: number;
      errors: Array<{ row: number; message: string }>;
    }>('/attendance/desk/route-teachers/import', {
      method: 'POST',
      body: JSON.stringify({ fileBase64 }),
    });
    if (r.errors.length)
      return {
        ok: true,
        text: 'Nothing was saved: correct these rows in the sheet and upload it again.',
        errors: r.errors,
      };
    revalidatePath('/attendance/setup');
    return {
      ok: true,
      text: `${String(r.added)} added${r.already ? `, ${String(r.already)} were already there` : ''}.`,
    };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}

/** An approver's decision on a student leave at their level. */
async function decideLeave(fd: FormData, outcome: 'approved' | 'rejected') {
  const id = str(fd, 'id');
  const here = `/attendance/leaves?tab=${str(fd, 'tab') || 'inbox'}`;
  try {
    await apiFetch(`/attendance/leaves/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail(`${here}&open=${id}`, error);
  }
  revalidatePath('/attendance/leaves');
  redirect(`${here}&ok=${outcome === 'approved' ? 'leave_approved' : 'leave_rejected'}`);
}

// each button has its own action: the decision does not depend on the browser sending the button's value
export async function approveLeave(fd: FormData) {
  return decideLeave(fd, 'approved');
}
export async function rejectLeave(fd: FormData) {
  return decideLeave(fd, 'rejected');
}

export async function saveLeaveSetup(input: {
  longDays: number;
  backDays: number;
  levels: Array<{
    chain: 'short' | 'long';
    label: string;
    kind: string;
    roleCode: string | null;
    employeeId: string | null;
    active: boolean;
  }>;
}): Promise<SetupResult> {
  try {
    await apiFetch('/attendance/leaves/setup', { method: 'PUT', body: JSON.stringify(input) });
    revalidatePath('/attendance/setup');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: said(error) };
  }
}

// ---- attendance from an Excel list (0093) ------------------------------------------------------------
/** Reads the file and shows the list for checking; nothing is marked yet. */
export async function verifyAttendanceUpload(fd: FormData) {
  const here = '/attendance/upload';
  const file = fd.get('file');
  let id = '';
  try {
    if (!(file instanceof File) || file.size === 0)
      throw new ApiError(400, { type: 'validation-failed', detail: 'Choose the Excel file.' });
    const r = await apiFetch<{ id: string }>('/attendance/bulk/verify', {
      method: 'POST',
      body: JSON.stringify({
        date: str(fd, 'date'),
        code: str(fd, 'code') === 'P' ? 'P' : 'A',
        fileName: file.name.slice(0, 200),
        fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      }),
    });
    id = r.id;
  } catch (error) {
    fail(here, error);
  }
  redirect(`${here}?id=${id}`);
}

/** Marks the checked list and tells the parents of the absent, as ticked. */
export async function commitAttendanceUpload(fd: FormData) {
  const id = str(fd, 'id');
  const here = `/attendance/upload?id=${id}`;
  try {
    await apiFetch(`/attendance/bulk/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({
        replace: fd.get('replace') !== null,
        restPresent: fd.get('restPresent') !== null,
        sms: fd.get('sms') !== null,
        email: fd.get('email') !== null,
      }),
    });
  } catch (error) {
    fail(here, error);
  }
  revalidatePath('/attendance');
  redirect(`${here}&ok=upload_marked`);
}

export async function cancelAttendanceUpload(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/attendance/bulk/${id}/cancel`, { method: 'POST' });
  } catch (error) {
    fail(`/attendance/upload?id=${id}`, error);
  }
  redirect('/attendance/upload?ok=upload_cancelled');
}
