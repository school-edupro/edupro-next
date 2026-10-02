import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The tickets behind a helpdesk dashboard count, as Excel. */
export async function GET(req: NextRequest) {
  const q = new URLSearchParams();
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  q.set('month', month);
  const desk = req.nextUrl.searchParams.get('desk');
  if (desk && ['parent', 'staff', 'provider'].includes(desk)) q.set('desk', desk);
  const bucket = req.nextUrl.searchParams.get('bucket');
  if (bucket && ['raised', 'resolved', 'escalated', 'breached', 'open'].includes(bucket))
    q.set('bucket', bucket);
  const res = await apiFetchRaw(`/helpdesk/report.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="helpdesk.xlsx"',
    },
  });
}
