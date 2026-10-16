import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The hostel roll-call register of a month as Excel or PDF. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const month = sp.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const qs = new URLSearchParams({ month, format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const hostel = sp.get('hostel') ?? '';
  if (/^\d{1,18}$/.test(hostel)) qs.set('hostelId', hostel);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/hostel/rollcall/register/file?${qs.toString()}`,
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
