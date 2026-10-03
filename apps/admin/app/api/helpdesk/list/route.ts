import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The desk list with the filters on screen, as Excel (latest first). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = (sp.get(key) ?? '').trim();
    if (v && ok(v)) q.set(key, v);
  };
  pick('desk', (v) => ['parent', 'staff', 'provider'].includes(v));
  pick('status', (v) =>
    ['open', 'in_progress', 'answered', 'closed', 'active', 'overdue'].includes(v),
  );
  pick('view', (v) => ['all', 'mine', 'assigned'].includes(v));
  pick('head', (v) => /^[a-z][a-z0-9_]{1,39}$/.test(v));
  pick('q', (v) => v.length <= 80);
  const res = await apiFetchRaw(`/helpdesk/tickets.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="helpdesk.xlsx"',
    },
  });
}
