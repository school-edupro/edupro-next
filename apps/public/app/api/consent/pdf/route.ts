import { NextResponse } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { consentFetch, SCHOOL_RE, TOKEN_RE } from '@/lib/consent';

/** The PDF copy of one's own answer on a form's public link. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const school = sp.get('school') ?? '';
  const token = sp.get('token') ?? '';
  const rid = sp.get('rid') ?? '';
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token) || !/^\d{1,18}$/.test(rid))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  try {
    const f = await consentFetch<{ filename: string; contentType: string; base64: string }>(
      school,
      token,
      `/responses/${rid}/pdf`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${sp.get('save') === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof PublicApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
