import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A fee receipt as a PDF file (school copy and parent copy), made at once by the API. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/fees/payments/${id}/receipt-file`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
