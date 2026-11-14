import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';
import { payrollFile } from '@/lib/payroll-file';

/** All of a run's payslips (a checker): one office copy (PDF) or a zip of each employee's locked file. */
export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get('run') ?? '';
  const zip = req.nextUrl.searchParams.get('mode') === 'zip';
  if (!/^\d{1,18}$/.test(run)) return new NextResponse(null, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; base64: string }>(
      `/payroll/runs/${run}/payslips?mode=${zip ? 'zip' : 'single'}`,
    );
    return payrollFile(f, false, zip ? 'application/zip' : 'application/pdf');
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
