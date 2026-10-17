import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;

/**
 * Consent form files: the register (answered or pending) as Excel or PDF, a response's PDF copy, and a
 * drawn signature (PNG, shown on the response page).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id') ?? '';
  const rid = sp.get('rid') ?? '';
  const kind = sp.get('kind');
  if (!ID.test(id) || (kind !== 'register' && kind !== 'qr' && !ID.test(rid)))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  let path: string;
  if (kind === 'register') {
    const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
    qs.set('tab', sp.get('tab') === 'pending' ? 'pending' : 'answered');
    for (const k of ['sectionId', 'q']) {
      const v = sp.get(k);
      if (v) qs.set(k, v.slice(0, 80));
    }
    path = `/engagement/consent-forms/${id}/register/file?${qs.toString()}`;
  } else if (kind === 'qr') path = `/engagement/consent-forms/${id}/qr`;
  else if (kind === 'pdf') path = `/engagement/consent-forms/${id}/responses/${rid}/pdf`;
  else if (kind === 'signature') {
    const key = sp.get('key') ?? '';
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key))
      return NextResponse.json({ type: 'not-found' }, { status: 404 });
    path = `/engagement/consent-forms/${id}/responses/${rid}/signatures/${key}`;
  } else return NextResponse.json({ type: 'not-found' }, { status: 404 });
  try {
    const f = await apiFetch<{ filename?: string; contentType: string; base64: string }>(path);
    const inline =
      kind === 'signature' || ((kind === 'pdf' || kind === 'qr') && sp.get('save') !== '1');
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.filename ?? 'signature.png'}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
