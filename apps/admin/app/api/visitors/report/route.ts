import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The visitor register with the filters on screen, as Excel. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = (sp.get(key) ?? '').trim();
    if (v && ok(v)) q.set(key, v);
  };
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  pick('state', (v) => ['inside', 'waiting', 'today', 'left', 'all'].includes(v));
  pick('from', date);
  pick('to', date);
  pick('type', (v) => v.length <= 60);
  pick('q', (v) => v.length <= 80);
  const res = await apiFetchRaw(`/visitors/report.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="visitors.xlsx"',
    },
  });
}
