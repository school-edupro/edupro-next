import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * The card of a gate pass I may see (my own, or one at my approval level), as a PDF on the app's own origin;
 * `?save=1` downloads it. The API checks who may see it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  let res: Response;
  try {
    res = await bff.api.raw(`/gate-passes/${id}/card.pdf`);
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
  if (!res.ok) return new NextResponse(null, { status: res.status });
  const save = req.nextUrl.searchParams.get('save') === '1';
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${save ? 'attachment' : 'inline'}; filename="gate-pass-${id}.pdf"`,
      'x-content-type-options': 'nosniff',
    },
  });
}
