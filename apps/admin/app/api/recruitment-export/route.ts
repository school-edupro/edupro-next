import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const STATUS = [
  'submitted',
  'screening',
  'selected',
  'rejected',
  'on_hold',
  'withdrawn',
  'joined',
  'returned',
];

/**
 * The candidates as an Excel workbook (docs/design/34-recruitment.md, part 9): the list's filters
 * (vacancy, stage, status, search, employee match), or the ticked ones (`ids`). The API checks the right
 * to see candidates, masks Aadhaar and PAN for those without the sensitive right and logs the export.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = (k: string) => {
    const v = sp.get(k) ?? '';
    return ID.test(v) ? v : undefined;
  };
  const status = sp.get('status') ?? '';
  const ids = sp
    .getAll('ids')
    .filter((x) => ID.test(x))
    .slice(0, 2000);
  // "Export ticked" with nothing ticked: back to the list, rather than every candidate
  if (sp.get('ticked') && !ids.length) {
    const back = sp.get('back') ?? '';
    const to = new URL(
      back.startsWith('/people/recruitment/candidates') ? back : '/people/recruitment/candidates',
      req.nextUrl.origin,
    );
    to.searchParams.set('error', 'validation-failed');
    to.searchParams.set('detail', 'Tick the candidates to export first.');
    return NextResponse.redirect(to, 303);
  }
  const body = ids.length
    ? { ids }
    : {
        vacancy: id('vacancy'),
        stage: id('vacancy') ? id('stage') : undefined,
        status: STATUS.includes(status) ? status : undefined,
        q: (sp.get('q') ?? '').trim().slice(0, 80) || undefined,
        match: sp.get('match') ? '1' : undefined,
      };
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/people/recruitment/applications/export',
      { method: 'POST', body: JSON.stringify(body) },
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
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
