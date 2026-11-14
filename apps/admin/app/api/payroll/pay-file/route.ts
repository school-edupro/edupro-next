import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { payrollFile } from '@/lib/payroll-file';

const okId = (v: string | null) => !!v && /^\d{1,18}$/.test(v);
const okMonth = (v: string | null) => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const oneOf = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;

/**
 * The payment and statutory files (docs/design/86, phase C): a bank file or its letter, the ECR (next or as filed),
 * the ESIC upload, a register, the salary voucher. The API checks the rights; a PDF opens in the tab unless saved.
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
  else if (kind === 'voucher' && okMonth(month))
    path = `/payroll/voucher/file?month=${month!}&format=${oneOf(p.get('format'), ['xlsx', 'csv', 'pdf'], 'xlsx')}`;
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
