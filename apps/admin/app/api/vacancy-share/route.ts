import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Sharing a vacancy (docs/design/34-recruitment.md, part 5): the QR of a published vacancy
 * (`?id=…&kind=qr`), its A4 poster (`kind=poster`) or the QR of the school's careers page
 * (`kind=careers`). Shown in the browser, or saved with `save=1`.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id') ?? '';
  const kind = sp.get('kind');
  let path: string;
  if (kind === 'careers') path = '/people/recruitment/setup/careers';
  else if ((kind === 'qr' || kind === 'poster') && /^\d{1,18}$/.test(id))
    path = `/people/recruitment/vacancies/${id}/${kind}`;
  else return NextResponse.json({ type: 'not-found' }, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(path);
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${sp.get('save') === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
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
