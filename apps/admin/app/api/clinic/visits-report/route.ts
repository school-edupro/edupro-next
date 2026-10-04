import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Clinic visits with the filters on screen, as Excel. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = (sp.get(key) ?? '').trim();
    if (v && ok(v)) q.set(key, v);
  };
  const date = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const id = (v: string) => /^\d{1,18}$/.test(v);
  pick('tab', (v) => ['today', 'in_clinic', 'all'].includes(v));
  pick('audience', (v) => ['student', 'staff'].includes(v));
  pick('outcome', (v) => ['back_to_class', 'rest', 'sent_home', 'referred'].includes(v));
  pick('doctorId', id);
  pick('diseaseId', id);
  pick('from', date);
  pick('to', date);
  pick('q', (v) => v.length <= 80);
  const res = await apiFetchRaw(`/clinic/visits.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="clinic-visits.xlsx"',
    },
  });
}
