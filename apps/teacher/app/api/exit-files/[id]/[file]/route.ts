import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

const FILES: Record<string, string> = {
  fnf: 'fnf.pdf',
  acceptance: 'letters/acceptance.pdf',
};

/** My exit papers: the acceptance letter and the approved full and final statement. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !FILES[file]) return new NextResponse(null, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await bff.api.raw(`/people/exits/${id}/${FILES[file]}${save ? '?save=1' : ''}`);
  if (!res.ok) return new NextResponse(null, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
