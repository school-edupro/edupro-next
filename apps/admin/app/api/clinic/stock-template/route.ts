import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The opening-stock Excel to fill: the Medicine column is a drop-down of the school's medicines. */
export async function GET() {
  const res = await apiFetchRaw('/clinic/stock/template.xlsx');
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ??
        'attachment; filename="clinic-opening-stock.xlsx"',
    },
  });
}
