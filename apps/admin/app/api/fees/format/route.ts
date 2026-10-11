import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const FILES: Record<string, [path: string, name: string]> = {
  settlement: ['/fees/requests/settlement-format.xlsx', 'fee-settlement-dates-format.xlsx'],
  collection: ['/fees/requests/collection-format.xlsx', 'fee-collection-format.xlsx'],
};

/** The Excel formats of the fee uploads: settlement dates and bulk collection. */
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind') ?? '';
  const classId = new URL(req.url).searchParams.get('classId') ?? '';
  // opening balances: blank, or with the pupils of a class and their present figure filled in
  const file =
    kind === 'opening'
      ? ([
          `/fees/opening/format.xlsx${/^\d{1,18}$/.test(classId) ? `?classId=${classId}` : ''}`,
          'opening-balance-format.xlsx',
        ] as [string, string])
      : FILES[kind];
  if (!file) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(file[0]);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${file[1]}"`,
    },
  });
}
