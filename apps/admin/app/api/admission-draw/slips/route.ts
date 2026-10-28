import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The draw slips of a points total (PDF, docs/design/60, 62): shown in the browser, or saved with `?save=1`. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  for (const k of ['cycleId', 'classId', 'categoryId']) {
    const v = sp.get(k);
    if (v && /^\d{1,18}$/.test(v)) q.set(k, v);
  }
  const points = sp.get('points') ?? '';
  if (!q.get('cycleId') || !q.get('classId') || !/^-?\d{1,7}(\.\d{1,2})?$/.test(points))
    return new NextResponse(null, { status: 404 });
  q.set('points', points);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/admissions/draw/slips?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${sp.get('save') === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
