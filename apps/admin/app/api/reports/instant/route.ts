import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A list report as Excel, CSV or PDF made at once by the API and handed to the browser as a file.
 * Every other query key is a parameter of the report (dates, class, mode …).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const dataset = sp.get('dataset') ?? '';
  const format = sp.get('format') ?? 'xlsx';
  if (!/^[a-z0-9_]{2,60}$/.test(dataset) || !['xlsx', 'csv', 'pdf'].includes(format))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const params: Record<string, string> = {};
  for (const [k, v] of sp.entries())
    if (!['dataset', 'format'].includes(k) && /^[A-Za-z]{1,30}$/.test(k) && v)
      params[k] = v.slice(0, 120);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/reports/exports/instant',
      { method: 'POST', body: JSON.stringify({ dataset, format, params }) },
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(
        { type: error.problem.type, detail: error.problem.detail },
        { status: error.status },
      );
    throw error;
  }
}
