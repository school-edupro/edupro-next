import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const KEY = /^[a-z0-9_.]{1,60}$/;
/** The book list's filters the export passes on, with what each must look like. */
const FILTERS: Record<string, RegExp> = {
  q: /^.{1,80}$/,
  libraryId: ID,
  materialTypeId: ID,
  subjectId: ID,
  languageId: ID,
  classId: ID,
  shelfId: ID,
  rack: /^.{1,20}$/,
  author: /^.{1,80}$/,
  publisher: /^.{1,80}$/,
  status: /^(available|issued|lost|damaged|withdrawn|sold)$/,
  acquisition: /^(Purchase|Donation)$/,
  vendorId: ID,
  accessionFrom: /^[A-Za-z0-9/ -]{1,30}$/,
  accessionTo: /^[A-Za-z0-9/ -]{1,30}$/,
  accessionedFrom: /^\d{4}-\d{2}-\d{2}$/,
  accessionedTo: /^\d{4}-\d{2}-\d{2}$/,
  yearFrom: /^\d{4}$/,
  yearTo: /^\d{4}$/,
  stock: /^(never|checked)$/,
  checkedSince: /^\d{4}-\d{2}-\d{2}$/,
  sort: /^(title|author|accession|callNo|year|publisher|price|accessioned|status|library)$/,
  dir: /^(asc|desc)$/,
};

interface Input {
  get: (k: string) => string | null;
  getAll: (k: string) => string[];
}

/**
 * The book list as Excel (docs/design/36-library.md, part 3): the list's filters and sort, one row per
 * copy or per title (`level`), every field or the fields picked (`columns`, posted by the export picker).
 * The API checks the right to see the catalogue, keeps the user's last choice and logs the export.
 */
async function workbook(sp: Input) {
  const body: Record<string, unknown> = {};
  for (const [k, re] of Object.entries(FILTERS)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && re.test(v)) body[k] = v;
  }
  body.level = sp.get('level') === 'title' ? 'title' : 'copy';
  // the Books page's list: its filters choose the rows when the export is of the same kind of row
  const view = sp.get('view');
  if (view && view.length <= 20_000 && sp.get('viewLevel') === body.level) {
    try {
      body.view = JSON.parse(view) as unknown;
    } catch {
      // a view that does not read is left out: every book
    }
  }
  const columns = sp
    .getAll('columns')
    .filter((x) => KEY.test(x))
    .slice(0, 400);
  if (columns.length) {
    body.columns = columns;
    const layout = (sp.get('layout') ?? '').trim().slice(0, 60);
    if (layout) body.layout = layout;
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/library/books/export',
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
  return workbook({ get: (k) => sp.get(k), getAll: (k) => sp.getAll(k) });
}

/** The export picker posts its choice (a long field list does not fit an address). */
export async function POST(req: NextRequest) {
  // only this app's own pages may post here
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const fd = await req.formData();
  const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : null);
  return workbook({
    get: (k) => text(fd.get(k)),
    getAll: (k) => fd.getAll(k).filter((v): v is string => typeof v === 'string'),
  });
}
