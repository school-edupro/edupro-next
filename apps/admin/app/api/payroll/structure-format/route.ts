import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The salary-structure sheet: a row per employee and head with the amount in force, to change and upload. */
export async function GET() {
  try {
    const f = await apiFetch<{ filename: string; base64: string }>('/payroll/structures/format');
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
