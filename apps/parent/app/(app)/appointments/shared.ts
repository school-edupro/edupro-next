/** What the appointment screens of the parent app share: shapes, status words and date helpers. */
export type State =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
export interface Appointment {
  id: string;
  number: string;
  state: State;
  student: string | null;
  hostName: string | null;
  withName: string | null;
  purpose: string;
  startsAt: string | null;
  place: string | null;
}
export const STATE: Record<State, [string, 'warning' | 'success' | 'danger' | 'info' | 'neutral']> =
  {
    requested: ['Waiting for the school', 'warning'],
    approved: ['Confirmed', 'success'],
    rejected: ['Not confirmed', 'danger'],
    cancelled: ['Cancelled', 'neutral'],
    checked_in: ['Arrived', 'info'],
    completed: ['Completed', 'neutral'],
    no_show: ['Did not come', 'danger'],
  };
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const IST = 'Asia/Kolkata';
/** 05 / Oct / Mon, for the date block of a card (school time). */
export const dayParts = (v: string) => {
  const d = new Date(v);
  return {
    day: d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit' }),
    month: d.toLocaleDateString('en-IN', { timeZone: IST, month: 'short', weekday: 'short' }),
  };
};
export const timeOf = (v: string) =>
  new Date(v).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });
export const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: IST,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** A plain date (YYYY-MM-DD) as "Mon, 05 Oct". */
export const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
/** Visiting hours on one line, the days with the same hours together: Mon–Fri 14:00–15:00. */
export function hoursLine(hours: Array<{ weekday: number; starts: string; ends: string }>): string {
  const byTime = new Map<string, number[]>();
  for (const o of hours)
    byTime.set(`${o.starts}–${o.ends}`, [
      ...(byTime.get(`${o.starts}–${o.ends}`) ?? []),
      o.weekday,
    ]);
  return [...byTime.entries()]
    .map(([time, list]) => {
      const d = [...new Set(list)].sort((a, b) => a - b);
      const run = d.length > 2 && d.every((v, n) => n === 0 || v === d[n - 1]! + 1);
      return `${run ? `${DAYS[d[0]! - 1]!}–${DAYS[d[d.length - 1]! - 1]!}` : d.map((v) => DAYS[v - 1]).join(', ')} ${time}`;
    })
    .join(' · ');
}
