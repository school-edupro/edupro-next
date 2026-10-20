import { NextResponse } from 'next/server';
import { CAREERS_COOKIE } from '@/lib/careers';

export async function POST(req: Request) {
  const back = new URL(req.url).searchParams.get('to') ?? '/';
  const out = NextResponse.redirect(new URL(back.startsWith('/') ? back : '/', req.url), 303);
  out.cookies.set(CAREERS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return out;
}
