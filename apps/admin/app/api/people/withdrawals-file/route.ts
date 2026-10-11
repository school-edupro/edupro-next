import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KEYS = [
  'status',
  'mine',
  'classId',
  'classSectionId',
  'leavingFrom',
  'leavingTo',
  'tc',
  'refund',
  'q',
];

/** The withdrawal register as filtered on the screen, as Excel or PDF, made at once by the API. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 80));
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/people/withdrawals/file?${qs.toString()}`,
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
