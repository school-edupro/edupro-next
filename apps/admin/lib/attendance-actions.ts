'use server';
/** Attendance (0083): bus roll marked from the ERP, the set-up, and reopening a day. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent((error.problem.detail ?? '').slice(0, 300))}`,
    );
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
  routeTeachers: Array<{ routeId: string; trip: 'pick' | 'drop'; employeeId: string }>;
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
