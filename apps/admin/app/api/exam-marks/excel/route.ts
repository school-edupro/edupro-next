import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A section's marks sheet of one subject (Excel, docs/design/65): saved, never shown. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ids = ['examId', 'classSectionId', 'subjectId'].map((k) => sp.get(k) ?? '');
  if (!ids.every((v) => /^\d{1,18}$/.test(v))) return new NextResponse(null, { status: 404 });
  const [examId, classSectionId, subjectId] = ids;
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/${examId!}/marks/excel?classSectionId=${classSectionId!}&subjectId=${subjectId!}`,
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
