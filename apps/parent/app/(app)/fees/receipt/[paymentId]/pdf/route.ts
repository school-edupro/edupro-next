import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The family's own receipt as a PDF file, made at once by the API (no waiting for a worker). */
export async function GET(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!/^\d{1,18}$/.test(paymentId)) return NextResponse.redirect(new URL('/fees', req.url), 303);
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/fees/mine/receipts/${paymentId}/file`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const to = error.status === 401 ? '/login?error=session-expired' : '/fees?error=not-found';
      return NextResponse.redirect(new URL(to, req.url), 303);
    }
    throw error;
  }
}
