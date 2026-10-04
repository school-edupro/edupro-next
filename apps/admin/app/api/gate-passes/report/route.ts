import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The gate pass register with the filters on screen, as Excel. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = (sp.get(key) ?? '').trim();
    if (v && ok(v)) q.set(key, v);
  };
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  pick('stage', (v) =>
    ['approval', 'handover', 'gate', 'out', 'closed', 'today', 'all'].includes(v),
  );
  pick('audience', (v) => ['student', 'staff'].includes(v));
  pick('from', date);
  pick('to', date);
  pick('q', (v) => v.length <= 80);
  const res = await apiFetchRaw(`/gate-passes/report.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="gate-passes.xlsx"',
    },
  });
}
