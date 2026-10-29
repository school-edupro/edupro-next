import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KINDS = ['subjects', 'ranges', 'toppers', 'teachers', 'status', 'missing', 'divisions'];
const KEYS = [
  'classId',
  'classSectionId',
  'subjectId',
  'top',
  'minPct',
  'belowPct',
  'by',
  'ranges',
];

/**
 * An exam analysis (docs/design/65 part 6) as Excel (saved) or PDF (shown, or saved with ?save=1);
 * `divisions` is a result scheme's merit list. The filters ride in the path (`q`, or `-`).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string; format: string; q: string }> },
) {
  const { id, kind, format, q } = await params;
  if (!/^\d{1,18}$/.test(id) || !KINDS.includes(kind) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  const given = new URLSearchParams(q === '-' ? '' : decodeURIComponent(q));
  const query = new URLSearchParams();
  for (const k of KEYS) {
    const v = given.get(k);
    if (v && /^[\w.,-]{1,60}$/.test(v)) query.set(k, v);
  }
  query.set('format', format);
  const path =
    kind === 'divisions'
      ? `/exams/schemes/${id}/divisions?${query.toString()}`
      : `/exams/${id}/reports/${kind}?${query.toString()}`;
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(path);
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
