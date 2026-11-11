import type { NextRequest } from 'next/server';
import { fileFrom } from '@/lib/file-proxy';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const m = sp.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(m)) q.set('month', m);
  return fileFrom(`/leave/self/attendance-file?${q.toString()}`);
}
