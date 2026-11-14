import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';
import { payrollFile } from '@/lib/payroll-file';

const ok = (v: string | null) => !!v && /^\d{1,18}$/.test(v);

/** One payslip of a locked run (payroll staff): the PDF, locked with the employee's password. */
export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get('run');
  const record = req.nextUrl.searchParams.get('record');
  if (!ok(run) || !ok(record)) return new NextResponse(null, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; base64: string }>(
      `/payroll/runs/${run!}/records/${record!}/payslip`,
    );
    return payrollFile(f, req.nextUrl.searchParams.get('save') !== '1');
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
