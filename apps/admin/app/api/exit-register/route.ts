import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The exit register as Excel, with the page's filters. */
export async function GET(req: NextRequest) {
  const q = new URLSearchParams();
  for (const k of ['from', 'to', 'exitType']) {
    const v = req.nextUrl.searchParams.get(k);
    if (v && /^[\w-]{1,40}$/.test(v)) q.set(k, v);
  }
  const res = await apiFetchRaw(`/people/exits/register.xlsx${q.size ? `?${q.toString()}` : ''}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="exit-register.xlsx"',
    },
  });
}
