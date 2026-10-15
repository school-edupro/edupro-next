import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The go-live Excel of the hostel (beds and allotments), with the school's hostels and room types as lists. */
export async function GET() {
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/hostel/import/template',
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
