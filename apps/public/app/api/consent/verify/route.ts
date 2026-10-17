import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { CONSENT_COOKIE, SCHOOL_RE, TOKEN_RE } from '@/lib/consent';

/** Checks the code; the pass for the form goes into an HttpOnly cookie the browser never reads. */
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, string | undefined>;
  const school = body.school ?? '';
  const token = body.token ?? '';
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await fetch(`${API}/api/v1/public/consent-forms/${school}/${token}/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: body.mode,
      mobile: body.mobile || undefined,
      email: body.email || undefined,
      admissionNo: body.admissionNo || undefined,
      code: body.code,
      name: body.name || undefined,
    }),
    cache: 'no-store',
  });
  const data = (await res.json()) as { token?: string; expiresAt?: string };
  const out = NextResponse.json(res.ok ? { ok: true } : data, { status: res.status });
  if (res.ok && data.token)
    out.cookies.set(CONSENT_COOKIE, data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
  return out;
}
