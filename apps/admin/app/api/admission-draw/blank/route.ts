import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Blank draw slips in the class's layout (PDF, docs/design/62): shown in the browser, or saved with `?save=1`. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const cycleId = sp.get('cycleId') ?? '';
  const classId = sp.get('classId') ?? '';
  const pages = sp.get('pages') ?? '1';
  if (!/^\d{1,18}$/.test(cycleId) || !/^\d{1,18}$/.test(classId) || !/^\d{1,2}$/.test(pages))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/admissions/draw/blank?${new URLSearchParams({ cycleId, classId, pages }).toString()}`,
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
