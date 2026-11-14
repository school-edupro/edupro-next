import { NextResponse } from 'next/server';

/** A payroll file the API sent as base64 (a payslip PDF, a zip of them), shown in the tab or saved. */
export function payrollFile(
  f: { filename: string; base64: string },
  inline = false,
  type = 'application/pdf',
) {
  return new NextResponse(Buffer.from(f.base64, 'base64'), {
    headers: {
      'content-type': type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
