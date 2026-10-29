import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A section's subject choices (Excel, docs/design/65): saved, never shown. */
export async function GET(req: NextRequest) {
  const sectionId = req.nextUrl.searchParams.get('classSectionId') ?? '';
  if (!/^\d{1,18}$/.test(sectionId)) return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/subject-choices/excel?classSectionId=${sectionId}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
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
