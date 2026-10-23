import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { ADMISSION_COOKIE } from '@/lib/admission';

/** The code exchanged for the admission token, kept in an HttpOnly cookie. */
export async function POST(req: Request) {
  const body = (await req.json()) as { school: string; identifier: string; code: string };
  const res = await fetch(`${API}/api/v1/public/admission/code/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schoolCode: body.school, identifier: body.identifier, code: body.code }),
    cache: 'no-store',
  });
  const data = (await res.json()) as { token?: string; expiresAt?: string };
  const out = NextResponse.json(res.ok ? { ok: true } : data, { status: res.status });
  if (res.ok && data.token)
    out.cookies.set(ADMISSION_COOKIE, data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
  return out;
}
