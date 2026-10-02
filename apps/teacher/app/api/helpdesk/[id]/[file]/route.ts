import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** A file on a helpdesk ticket the teacher may see, as a short signed link; `?save=1` downloads. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ download: { url: string; saveUrl?: string } }>(
      `/helpdesk/tickets/${id}/files/${file}`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return NextResponse.redirect(save ? (r.download.saveUrl ?? r.download.url) : r.download.url, {
      status: 303,
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
