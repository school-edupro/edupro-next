import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Reporties attendance as on the tab (all of them a column a day, or one day by day) as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of ['from', 'to']) if (DAY.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
  const e = sp.get('employeeId') ?? '';
  if (/^\d{1,18}$/.test(e)) q.set('employeeId', e);
  return fileFrom(`/staff-attendance/team?${q.toString()}`);
}
