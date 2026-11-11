import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

const STATUSES = ['waiting', 'pending', 'approved', 'rejected', 'withdrawn', 'cancelled'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;

/** Reporties leave as filtered on the tab, all of it, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const m = sp.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(m)) q.set('month', m);
  for (const k of ['from', 'to']) if (DAY.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
  for (const k of ['employeeId', 'leaveTypeId']) if (ID.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
  const s = sp.get('status') ?? '';
  if (STATUSES.includes(s)) q.set('status', s);
  const t = (sp.get('q') ?? '').trim().slice(0, 80);
  if (t) q.set('q', t);
  return fileFrom(`/leave/self/team?${q.toString()}`);
}
