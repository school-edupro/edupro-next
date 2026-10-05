import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The Excel to fill for many pupils at once: service, stoppage and month are drop-downs. */
export async function GET() {
  const res = await apiFetchRaw('/transport/requests/template.xlsx');
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="transport-requests.xlsx"',
    },
  });
}
