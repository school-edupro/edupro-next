import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const BASE: Record<string, string> = {
  homework: '/academics/daily-work',
  notice: '/academics/notices',
};

/**
 * A homework or notice attachment for the family: the API checks the family may see that homework or
 * notice and signs a short-lived link. PDFs and images open in the browser; `?save=1` downloads.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string; file: string }> },
) {
  const { kind, id, file } = await params;
  const base = BASE[kind];
  if (!base || !/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ download: { url: string; saveUrl?: string } }>(
      `${base}/${id}/files/${file}`,
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
