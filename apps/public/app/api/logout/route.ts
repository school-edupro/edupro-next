import { NextResponse } from 'next/server';
import { COOKIE } from '@/lib/api';

export async function POST(req: Request) {
  const back = new URL(req.url).searchParams.get('to') ?? '/';
  const out = NextResponse.redirect(new URL(back.startsWith('/') ? back : '/', req.url), 303);
  out.cookies.set(COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return out;
}
