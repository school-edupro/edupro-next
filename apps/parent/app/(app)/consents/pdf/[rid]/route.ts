import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The PDF copy of a consent form answered for one of the family's children. */
export async function GET(req: Request, { params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  if (!/^\d{1,18}$/.test(rid)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/engagement/mine/consent-forms/responses/${rid}/pdf`,
    );
    const save = new URL(req.url).searchParams.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
