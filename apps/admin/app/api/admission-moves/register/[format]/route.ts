import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The register of moves between schools (docs/design/64): the PDF shown (or saved), the Excel saved. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== 'pdf' && format !== 'xlsx') return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/admissions/moves/export?format=${format}`,
    );
    const save = format === 'xlsx' || req.nextUrl.searchParams.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename}"`,
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
