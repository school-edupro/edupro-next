import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** My leave touching From–To (or all of it) as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of ['from', 'to']) if (DAY.test(sp.get(k) ?? '')) q.set(k, sp.get(k)!);
  return fileFrom(`/leave/self/leave-file?${q.toString()}`);
}
