import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The CBSE result file of an upload as it was sent: View shows it as text, Download (`?save=1`) saves it. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const f = await apiFetch<{ fileName: string; text: string }>(
      `/exams/board-results/imports/${id}/file`,
    );
    const name = f.fileName.replace(/[^\w.\- ()]+/g, '_') || `board-result-${id}.txt`;
    const save = req.nextUrl.searchParams.get('save') === '1';
    return new NextResponse(f.text, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${name}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.redirect(
        new URL(
          `/exams/board-results/imports/${id}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? 'The file could not be opened')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
