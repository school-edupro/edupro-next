import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';
import { payrollFile } from '@/lib/payroll-file';

/** One of my payslips, locked with my password. */
export async function GET(req: NextRequest) {
  const record = req.nextUrl.searchParams.get('record') ?? '';
  if (!/^\d{1,18}$/.test(record)) return new NextResponse(null, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; base64: string }>(
      `/payroll/me/payslips/${record}`,
    );
    return payrollFile(f, req.nextUrl.searchParams.get('save') !== '1');
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
