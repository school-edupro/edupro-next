import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KEYS = ['from', 'to', 'ledger', 'classId', 'fromSeq', 'toSeq'];

/** A fee MIS report as Excel or PDF, laid out as on the screen, made at once by the API. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const report = sp.get('report') ?? '';
  if (!/^[a-z_]{3,40}$/.test(report))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 40));
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/fees/mis/${report}/file?${qs.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
