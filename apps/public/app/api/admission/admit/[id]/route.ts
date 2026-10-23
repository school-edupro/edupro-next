import { NextResponse, type NextRequest } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { admissionFetch } from '@/lib/admission';

/** The admit card of the test or interview (PDF): View, or Download with `?save=1`. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 404 });
  try {
    const f = await admissionFetch<{ filename: string; contentType: string; base64: string }>(
      `/me/applications/${id}/admit-card`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof PublicApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
