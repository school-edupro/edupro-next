import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * A month's attendance register as Excel or PDF, on the app's own origin: the class register of one of
 * the teacher's sections (`section`), or the bus register of a route and trip mapped to them (`route`,
 * `trip`). The API checks that the teacher may see it.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const month = sp.get('month') ?? '';
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const section = sp.get('section') ?? '';
  const route = sp.get('route') ?? '';
  const trip = sp.get('trip') === 'drop' ? 'drop' : 'pick';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new NextResponse(null, { status: 400 });
  const path = /^\d{1,18}$/.test(section)
    ? `/attendance/desk/class-register/file?classSectionId=${section}&month=${month}&format=${format}`
    : /^\d{1,18}$/.test(route)
      ? `/attendance/bus-roll/register/file?routeId=${route}&trip=${trip}&month=${month}&format=${format}`
      : null;
  if (!path) return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(path);
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]+/g, '_')}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
