import { NextResponse } from 'next/server';
import { CONSENT_COOKIE } from '@/lib/consent';

/** Signs out of a form's public link and goes back to it. */
export async function POST(req: Request) {
  const to = new URL(req.url).searchParams.get('to') ?? '/';
  const out = NextResponse.redirect(
    new URL(/^\/[a-z0-9-]{1,40}\/consent\/[A-Za-z0-9_-]{10,60}$/.test(to) ? to : '/', req.url),
    303,
  );
  out.cookies.set(CONSENT_COOKIE, '', { path: '/', maxAge: 0 });
  return out;
}
