import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Streams the employee Excel template (update: pre-filled by code; create: empty). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') === 'create' ? 'create' : 'update';
  const q = new URLSearchParams({ mode });
  if (sp.get('includeInactive') === 'on') q.set('includeInactive', 'true');
  const fields = sp.getAll('field').filter((f) => /^[a-z0-9_]{2,60}$/.test(f));
  if (fields.length) q.set('fields', fields.join(','));
  const res = await apiFetchRaw(`/people/staff/bulk/template?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="employees-${mode}.xlsx"`,
    },
  });
}
