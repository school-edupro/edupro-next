import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const ALLOWED: Record<string, RegExp> = {
  tab: /^(pending|approved|rejected|all)$/,
  when: /^(now|upcoming|past|all)$/,
  source: /^(parent|office)$/,
  kind: /^(join|change|leave)$/,
  service: /^(pick|drop|both)$/,
  routeId: /^\d+$/,
  studentId: /^\d+$/,
  month: /^\d{4}-\d{2}$/,
  from: /^\d{4}-\d{2}-\d{2}$/,
  to: /^\d{4}-\d{2}-\d{2}$/,
  q: /^.{1,80}$/,
};

/** The transport requests with the filters on screen, as Excel. */
export async function GET(req: NextRequest) {
  const q = new URLSearchParams();
  for (const [key, ok] of Object.entries(ALLOWED)) {
    const v = (req.nextUrl.searchParams.get(key) ?? '').trim();
    if (v && ok.test(v)) q.set(key, v);
  }
  const res = await apiFetchRaw(`/transport/requests/export.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="transport-requests.xlsx"',
    },
  });
}
