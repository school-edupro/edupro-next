import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Files of a registration for the office: `form/<applicationId>` (the form as PDF), `receipt/<receiptId>`,
 * `file/<applicationId>:<fileId>` (an upload). Shown in the browser, or saved with `?save=1`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  let path: string | null = null;
  if (kind === 'form' && /^\d{1,18}$/.test(id)) path = `/admissions/applications/${id}/pdf`;
  if (kind === 'receipt' && /^\d{1,18}$/.test(id)) path = `/admissions/receipts/${id}/pdf`;
  if (kind === 'admit' && /^\d{1,18}$/.test(id))
    path = `/admissions/registrations/${id}/admit-card`;
  if (kind === 'admission' && /^\d{1,18}$/.test(id))
    path = `/admissions/registrations/${id}/admission-form`;
  const m = /^(\d{1,18})(?::|%3A)(\d{1,18})$/i.exec(id);
  if (kind === 'file' && m) path = `/admissions/applications/${m[1]}/files/${m[2]}`;
  if (!path) return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(path);
    const save = req.nextUrl.searchParams.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename.replace(/"/g, '')}"`,
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
