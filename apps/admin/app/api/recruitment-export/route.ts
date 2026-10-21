import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const KEY = /^[a-z0-9_.]{1,60}$/;
const LISTS = ['education', 'experience', 'training', 'children', 'references'];
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

/** The request's answers, whether from the address (GET) or a posted form (the export picker). */
interface Input {
  get: (k: string) => string | null;
  getAll: (k: string) => string[];
}

/**
 * The candidates as an Excel workbook (docs/design/34-recruitment.md, parts 9 and 10): the list's filters
 * (vacancy, stage, status, search, employee match), or the ticked ones (`ids`); every field, or the
 * fields picked in their order (`columns`) with the list sheets ticked (`sheets`), posted by the export
 * picker. The API checks the right to see candidates, masks Aadhaar and PAN for those without the
 * sensitive right, keeps the user's last choice and logs the export.
 */
async function workbook(req: NextRequest, sp: Input) {
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
  const columns = sp
    .getAll('columns')
    .filter((x) => KEY.test(x))
    .slice(0, 400);
  const pick = columns.length
    ? {
        columns,
        sheets: sp.getAll('sheets').filter((x) => LISTS.includes(x)),
        layout: (sp.get('layout') ?? '').trim().slice(0, 60) || undefined,
      }
    : {};
  const body = ids.length
    ? { ids, ...pick }
    : {
        vacancy: id('vacancy'),
        stage: id('vacancy') ? id('stage') : undefined,
        status: STATUS.includes(status) ? status : undefined,
        q: (sp.get('q') ?? '').trim().slice(0, 80) || undefined,
        match: sp.get('match') ? '1' : undefined,
        ...pick,
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return workbook(req, { get: (k) => sp.get(k), getAll: (k) => sp.getAll(k) });
}

/** The export picker posts its choice (a long field list does not fit an address). */
export async function POST(req: NextRequest) {
  // only this app's own pages may post here
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const fd = await req.formData();
  const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : null);
  return workbook(req, {
    get: (k) => text(fd.get(k)),
    getAll: (k) => fd.getAll(k).filter((v): v is string => typeof v === 'string'),
  });
}
