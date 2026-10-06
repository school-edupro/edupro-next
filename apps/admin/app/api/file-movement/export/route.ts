import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const KEYS = ['box', 'status', 'from', 'to', 'q'];

/** The file movement list with the filters on screen, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const q = new URLSearchParams({ format });
  for (const k of KEYS) {
    const v = (sp.get(k) ?? '').trim().slice(0, 80);
    if (v) q.set(k, v);
  }
  const res = await apiFetchRaw(`/file-movement/export?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="file-movement.${format}"`,
    },
  });
}
