import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The Excel format of enquiries to fill and upload, with the classes and sources as drop-downs. */
export async function GET() {
  const res = await apiFetchRaw('/admissions/enquiries/import-format.xlsx');
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="enquiries-format.xlsx"',
    },
  });
}
