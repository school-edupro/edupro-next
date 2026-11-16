import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import type { CertificateTemplateDetail } from '@/lib/certificates';

/** A saved template as it prints (the list's "See"): its body and styles with a sample of the type it is for. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ detail: 'No such template' }, { status: 400 });
  try {
    const t = await apiFetch<CertificateTemplateDetail>(`/certificates/setup/templates/${id}`);
    if (!t.forType)
      return NextResponse.json(
        { detail: 'No certificate type to take a sample from' },
        { status: 409 },
      );
    const r = await apiFetch<{ html: string }>('/certificates/setup/templates/preview', {
      method: 'POST',
      body: JSON.stringify({
        typeCode: t.forType,
        pageWidth: t.pageWidth,
        pageHeight: t.pageHeight,
        bodyHtml: t.bodyHtml || ' ',
        stylesCss: t.stylesCss,
      }),
    });
    return NextResponse.json({
      html: r.html,
      landscape: parseFloat(t.pageWidth) > parseFloat(t.pageHeight),
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(
        { detail: error.problem.detail ?? error.problem.type },
        { status: error.status },
      );
    throw error;
  }
}

/** The template editor's live preview: the body and styles as typed, rendered by the API (nothing saved). */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'The template could not be read' }, { status: 400 });
  }
  try {
    const r = await apiFetch<{ html: string }>('/certificates/setup/templates/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json({ html: r.html });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(
        { detail: error.problem.detail ?? error.problem.type },
        { status: error.status },
      );
    throw error;
  }
}
