import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The Excel format for payment terms, filled with the school's terms (docs/design/83). */
export async function GET() {
  try {
    const t = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/purchase/payment-terms/template',
    );
    return new NextResponse(Buffer.from(t.base64, 'base64'), {
      headers: {
        'content-type': t.contentType,
        'content-disposition': `attachment; filename="${t.filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
