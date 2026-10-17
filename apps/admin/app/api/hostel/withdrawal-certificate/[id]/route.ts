import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The hostel clearance certificate of a completed withdrawal, opened in the browser. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/hostel/withdrawals/${id}/certificate`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `inline; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
