import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * The child's profile as a PDF made at once by the API (only the fields this portal shows). It opens in
 * the browser; `download=1` saves it instead.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const child = url.searchParams.get('child') ?? '';
  if (!/^\d{1,18}$/.test(child)) return NextResponse.redirect(new URL('/profile', req.url), 303);
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/engagement/mine/profile/${child}/print/file`,
    );
    const how = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${how}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const to =
        error.status === 401
          ? '/login?error=session-expired'
          : `/profile?child=${child}&error=${encodeURIComponent('The PDF could not be made.')}`;
      return NextResponse.redirect(new URL(to, req.url), 303);
    }
    throw error;
  }
}
