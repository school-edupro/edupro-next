import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

/** The note sheet of an approved file I may see, as a PDF (opens; `?save=1` saves). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  const res = await bff.api.raw(`/file-movement/${id}/pdf`);
  if (!res.ok) return new NextResponse(null, { status: res.status });
  const save = req.nextUrl.searchParams.get('save') === '1';
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${save ? 'attachment' : 'inline'}; filename="file-${id}.pdf"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
