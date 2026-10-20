import { NextResponse } from 'next/server';
import { API } from '@/lib/api';
import { CAREERS_COOKIE } from '@/lib/careers';

/** The code exchanged for a candidate token, kept in an HttpOnly cookie. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    school: string;
    channel: 'mobile' | 'email';
    to: string;
    code: string;
    name?: string;
  };
  const res = await fetch(`${API}/api/v1/public/careers/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schoolCode: body.school,
      channel: body.channel,
      to: body.to,
      code: body.code,
      name: body.name || undefined,
    }),
    cache: 'no-store',
  });
  const data = (await res.json()) as { token?: string; expiresAt?: string };
  const out = NextResponse.json(res.ok ? { ok: true } : data, { status: res.status });
  if (res.ok && data.token)
    out.cookies.set(CAREERS_COOKIE, data.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: data.expiresAt ? new Date(data.expiresAt) : undefined,
    });
  return out;
}
