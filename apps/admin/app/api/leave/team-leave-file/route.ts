import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'cancelled'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const m = sp.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(m)) q.set('month', m);
  const s = sp.get('status') ?? '';
  if (STATUSES.includes(s)) q.set('status', s);
  const t = (sp.get('q') ?? '').trim().slice(0, 80);
  if (t) q.set('q', t);
  return fileFrom(`/leave/self/team?${q.toString()}`);
}
