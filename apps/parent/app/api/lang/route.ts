import { NextResponse } from 'next/server';
import { LANG_COOKIE } from '@/lib/i18n';

/** Switches the interface language (en | hi) and returns to the page that asked. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get('to') === 'hi' ? 'hi' : 'en';
  const back = url.searchParams.get('back') ?? '/';
  const out = NextResponse.redirect(
    new URL(back.startsWith('/') && !back.startsWith('//') ? back : '/', req.url),
    303,
  );
  out.cookies.set(LANG_COOKIE, to, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return out;
}
