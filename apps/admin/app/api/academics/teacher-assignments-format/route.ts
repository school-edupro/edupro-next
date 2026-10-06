import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The Excel format to fill and upload, with its drop-downs. */
export async function GET() {
  const res = await apiFetchRaw('/academics/teacher-assignments/template.xlsx');
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="teacher-assignments-format.xlsx"',
    },
  });
}
