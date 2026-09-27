import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/request';

/** Language switcher target: stores the choice in a cookie and returns to the page. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const locale = form.get('locale') === 'hi' ? 'hi' : 'en';
  const back = req.headers.get('referer') ?? '/';
  const res = NextResponse.redirect(back, { status: 303 });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
  });
  return res;
}
