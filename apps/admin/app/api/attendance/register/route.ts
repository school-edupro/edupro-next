import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** A month's attendance register (a class, or a route and trip) as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const month = sp.get('month') ?? '';
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const section = sp.get('section') ?? '';
  const route = sp.get('route') ?? '';
  const asked = sp.get('trip');
  const trip = asked === 'drop' || asked === 'pick' ? asked : 'both';
  const path = /^\d{1,18}$/.test(section)
    ? `/attendance/desk/class-register.${format}?classSectionId=${section}&month=${month}`
    : /^\d{1,18}$/.test(route)
      ? `/attendance/bus-roll/register.${format}?routeId=${route}&trip=${trip}&month=${month}`
      : null;
  if (!path) return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const res = await apiFetchRaw(path);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type':
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="register.${format}"`,
    },
  });
}
