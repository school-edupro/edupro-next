import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The enquiries of the filters on screen as Excel (docs/design/46, part 1). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = (sp.get(key) ?? '').trim();
    if (v && ok(v)) q.set(key, v);
  };
  const id = (v: string) => /^\d{1,18}$/.test(v);
  pick('stageId', id);
  pick('sourceId', id);
  pick('classId', id);
  pick('counsellor', (v) => v === 'me' || v === 'none' || id(v));
  pick('due', (v) => ['today', 'overdue', 'upcoming'].includes(v));
  pick('score', (v) => ['hot', 'warm', 'cold', 'none'].includes(v));
  pick('q', (v) => v.length <= 80);
  const res = await apiFetchRaw(`/admissions/enquiries/list.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="enquiries.xlsx"',
    },
  });
}
