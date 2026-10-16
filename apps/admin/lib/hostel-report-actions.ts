'use server';
/** Hostel reports: which columns a report shows (the user's own, or the school's default). */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
/** Where to go back: only a hostel page is accepted. */
const backTo = (fd: FormData) => {
  const b = str(fd, 'back');
  return b.startsWith('/hostel') && !b.includes('//') ? b : '/hostel';
};
const join = (path: string, q: string) => `${path}${path.includes('?') ? '&' : '?'}${q}`;
const REPORTS = new Set(['register', 'occupancy', 'withdrawals', 'leave']);

async function save(fd: FormData, scope: 'user' | 'school' | 'reset') {
  const back = backTo(fd);
  const report = str(fd, 'report');
  if (!REPORTS.has(report)) redirect(back);
  let hidden: unknown = [];
  try {
    hidden = JSON.parse(str(fd, 'hidden') || '[]');
  } catch {
    hidden = [];
  }
  try {
    if (scope === 'reset')
      await apiFetch(`/hostel/reports/${report}/columns`, { method: 'DELETE' });
    else
      await apiFetch(`/hostel/reports/${report}/columns`, {
        method: 'PUT',
        body: JSON.stringify({ hidden, scope }),
      });
  } catch (error) {
    if (error instanceof ApiError)
      redirect(
        join(
          back,
          `error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(String(error.problem.detail ?? '').slice(0, 200))}`,
        ),
      );
    throw error;
  }
  redirect(join(back, 'ok=1&detail=Columns%20saved.'));
}
export async function saveHostelColumnsMine(fd: FormData) {
  return save(fd, 'user');
}
export async function saveHostelColumnsSchool(fd: FormData) {
  return save(fd, 'school');
}
export async function resetHostelColumns(fd: FormData) {
  return save(fd, 'reset');
}
