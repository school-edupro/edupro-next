import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The certificate attached to a student leave: opens in the browser; `?save=1` downloads. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{ download: { url: string; saveUrl?: string } }>(
      `/attendance/leaves/${id}/files/${file}`,
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
