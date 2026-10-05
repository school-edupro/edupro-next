'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** The teacher of a route marks one trip (morning or afternoon) of one date. */
export async function markBusAttendance(fd: FormData) {
  const routeId = str(fd, 'routeId');
  const trip = str(fd, 'trip') === 'drop' ? 'drop' : 'pick';
  const date = str(fd, 'date');
  const back = `/bus-attendance?pick=${routeId}|${trip}&date=${date}`;
  const marks: Array<{ studentId: string; code: string; remarks?: string }> = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith('code-') || typeof value !== 'string' || !value) continue;
    const studentId = key.slice(5);
    marks.push({ studentId, code: value, remarks: str(fd, `remarks-${studentId}`) || undefined });
  }
  try {
    await bff.api.fetch('/attendance/bus-roll', {
      method: 'POST',
      body: JSON.stringify({ routeId, trip, date, marks }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1`);
}
