import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The late and missing issues to claim from the vendors (docs/design/36-library.md, part 6). */
export async function GET(req: NextRequest) {
  const vendor = req.nextUrl.searchParams.get('vendorId') ?? '';
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/library/subscriptions/claims${/^\d{1,18}$/.test(vendor) ? `?vendorId=${vendor}` : ''}`,
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
