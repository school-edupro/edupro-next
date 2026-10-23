import { NextResponse } from 'next/server';
import { ADMISSION_COOKIE } from '@/lib/admission';

export async function POST(req: Request) {
  const fd = await req.formData().catch(() => null);
  const school = String(fd?.get('school') ?? '').toLowerCase();
  const out = NextResponse.redirect(
    new URL(/^[a-z0-9-]{2,20}$/.test(school) ? `/${school}/admission` : '/', req.url),
    303,
  );
  out.cookies.delete(ADMISSION_COOKIE);
  return out;
}
