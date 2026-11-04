import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The API path of each section sheet (docs/design/71): what the teacher enters, as Excel to fill. */
const PATHS: Record<string, string> = {
  indicators: 'indicators/excel',
  remarks: 'remark-items/excel',
  health: 'health/excel',
};

/**
 * A section's entry sheet on the app's own origin: the indicators the teacher rates, the remark
 * categories they write, or the class's height and weight. The API checks what the teacher may see.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const path = PATHS[sp.get('kind') ?? ''];
  const exam = sp.get('exam') ?? '';
  const section = sp.get('section') ?? '';
  if (!path || !/^\d{1,18}$/.test(exam) || !/^\d{1,18}$/.test(section))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/${exam}/${path}?classSectionId=${section}`,
    );
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
