import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The Excel format for attendance by list: one column of admission numbers. */
export async function GET() {
  const res = await apiFetchRaw('/attendance/bulk/template.xlsx');
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="attendance-upload-format.xlsx"',
    },
  });
}
