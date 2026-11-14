import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { payrollFile } from '@/lib/payroll-file';

const okId = (v: string | null) => !!v && /^\d{1,18}$/.test(v);
const okMonth = (v: string | null) => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const okFy = (v: string | null) => !!v && /^\d{4}-\d{2}$/.test(v);
const oneOf = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;

/**
 * The payment and statutory files (docs/design/86, phase C): a bank file or its letter, the ECR (next or as filed),
 * the ESIC upload, a register, the salary voucher; the tax papers (phase D); the people papers (phase E): increment
 * letters, a settlement's statement or dues letter, the salary certificate, a loan's statement or no-dues certificate. The API checks the rights; a PDF opens in the tab unless saved.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kind = p.get('kind');
  const month = p.get('month');
  const id = p.get('id');
  let path: string | null = null;
  if (kind === 'bank' && okId(id))
    path = `/payroll/bank/batches/${id!}/file?as=${oneOf(p.get('as'), ['file', 'letter', 'pdf'], 'file')}`;
  else if (kind === 'ecr' && okMonth(month))
    path = `/payroll/statutory/pf/ecr?month=${month!}&part=${oneOf(p.get('part'), ['main', 'arrear'], 'main')}`;
  else if (kind === 'return' && okId(id))
    path = `/payroll/statutory/returns/${id!}/file?part=${oneOf(p.get('part'), ['main', 'arrear'], 'main')}`;
  else if (kind === 'esic' && okMonth(month))
    path = `/payroll/statutory/esi/upload?month=${month!}`;
  else if (kind === 'register' && okMonth(month))
    path = `/payroll/statutory/register?month=${month!}&kind=${oneOf(p.get('of'), ['pf', 'esi', 'pt', 'lwf'], 'pf')}&format=${oneOf(p.get('format'), ['xlsx', 'pdf'], 'xlsx')}`;
  else if (kind === 'taxreturn' && okFy(p.get('fy')))
    path = `/payroll/tax/returns?fy=${p.get('fy')!}&quarter=${oneOf(p.get('quarter'), ['1', '2', '3', '4'], '1')}&file=${oneOf(p.get('file'), ['challans', 'annexure1', 'annexure2'], 'challans')}`;
  else if (kind === 'declform' && okFy(p.get('fy')))
    path = okId(id)
      ? `/payroll/tax/declaration-form/${id!}?fy=${p.get('fy')!}`
      : `/payroll/me/tax/declaration-form?fy=${p.get('fy')!}`;
  else if (kind === 'cert' && okFy(p.get('fy')))
    path = okId(id)
      ? `/payroll/tax/certificates/${id!}/file?fy=${p.get('fy')!}`
      : `/payroll/me/tax/certificate?fy=${p.get('fy')!}`;
  else if (kind === 'proof' && okId(id)) {
    try {
      const r = await apiFetch<{
        file: { contentType: string; originalName?: string | null };
        download: { url: string };
      }>(`/payroll/tax/proofs/${id!}`);
      const url = r.download.url.startsWith('http')
        ? r.download.url
        : `${process.env.API_BASE_URL ?? 'http://localhost:4000'}${r.download.url}`;
      const got = await fetch(url, { cache: 'no-store' });
      if (!got.ok) return new NextResponse(null, { status: 502 });
      const save = p.get('save') === '1';
      return new NextResponse(await got.arrayBuffer(), {
        headers: {
          'content-type': r.file.contentType,
          'content-disposition': `${save ? 'attachment' : 'inline'}; filename="proof-${id!}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (e) {
      if (e instanceof ApiError) return new NextResponse(null, { status: e.status });
      throw e;
    }
  } else if (kind === 'report' && /^[a-z_]{2,40}$/.test(p.get('key') ?? '')) {
    // a report as a file: the same filters as the screen, passed through as they are
    const fwd = new URLSearchParams();
    for (const k of [
      'month',
      'fy',
      'asOf',
      'runId',
      'department',
      'staffType',
      'employeeId',
      'view',
      'columns',
      'groupBy',
      'threshold',
    ])
      if (p.get(k)) fwd.set(k, p.get(k)!);
    fwd.set('format', oneOf(p.get('format'), ['xlsx', 'pdf', 'csv'], 'xlsx'));
    path = `/payroll/reports/${p.get('key')!}/file?${fwd.toString()}`;
  } else if (kind === 'actuary' && /^\d{4}-\d{2}-\d{2}$/.test(p.get('asOf') ?? ''))
    path = `/payroll/gratuity/actuary?asOf=${p.get('asOf')!}`;
  else if (kind === 'auditlog') {
    const fwd = new URLSearchParams();
    for (const k of ['from', 'to', 'kind', 'table', 'action', 'who', 'record', 'contains'])
      if (p.get(k)) fwd.set(k, p.get(k)!);
    path = `/payroll/audit/export?${fwd.toString()}`;
  } else if (kind === 'golivearchive') path = '/payroll/golive/archive';
  else if (kind === 'auditpack' && okFy(p.get('fy')))
    path = `/payroll/audit/pack?fy=${p.get('fy')!}`;
  else if (kind === 'letters' && okId(id)) path = `/payroll/revisions/${id!}/letters/pdf`;
  else if (kind === 'letter' && okId(id))
    path = p.get('own') === '1' ? `/payroll/me/letters/${id!}/pdf` : `/payroll/letters/${id!}/pdf`;
  else if (kind === 'fnf' && okId(id)) path = `/payroll/settlements/${id!}/statement`;
  else if (kind === 'dues' && okId(id)) path = `/payroll/settlements/${id!}/dues-letter`;
  else if (kind === 'salcert' && okFy(p.get('fy')))
    path = okId(id)
      ? `/payroll/employees/${id!}/salary-certificate?fy=${p.get('fy')!}`
      : `/payroll/me/salary-certificate?fy=${p.get('fy')!}`;
  else if (kind === 'loan' && okId(id))
    path = `/payroll/loans/${id!}/paper?kind=${oneOf(p.get('of'), ['statement', 'noc'], 'statement')}`;
  else if (kind === 'voucher' && okMonth(month))
    path = `/payroll/voucher/file?month=${month!}&format=${oneOf(p.get('format'), ['xlsx', 'csv', 'pdf'], 'xlsx')}`;
  else if (kind === 'setuplist' && /^[a-z-]{2,40}$/.test(p.get('key') ?? '')) {
    // a payroll set-up list as a file: the list's own params and filters come as f_<name> (a list may have a
    // `kind` of its own) and go through as they are; the API checks them
    const fwd = new URLSearchParams();
    for (const [k, v] of p.entries())
      if (/^f_[A-Za-z]{1,20}$/.test(k) && v) fwd.set(k.slice(2), v.slice(0, 100));
    fwd.set('format', oneOf(p.get('format'), ['xlsx', 'pdf'], 'xlsx'));
    path = `/payroll/setup-lists/${p.get('key')!}/file?${fwd.toString()}`;
  } else if (kind === 'setupbook')
    path = `/payroll/setup-book?format=${oneOf(p.get('format'), ['xlsx', 'pdf'], 'xlsx')}`;
  if (!path) return new NextResponse(null, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; base64: string; contentType: string }>(path);
    const inline = f.contentType === 'application/pdf' && p.get('save') !== '1';
    return payrollFile(f, inline, f.contentType);
  } catch (e) {
    // a file refused (an ECR with a wrong UAN, nothing locked yet): say why, in the tab it opened
    if (e instanceof ApiError)
      return new NextResponse(e.problem.detail ?? 'This file cannot be made now.', {
        status: e.status,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    throw e;
  }
}
