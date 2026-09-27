import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { startLogin } from '@/lib/oidc';

/** Starts the One Auth code flow with PKCE; transient values live in a short-lived HttpOnly cookie. */
export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/';
  const start = await startLogin(returnTo);
  const store = await cookies();
  store.set(
    'edupro_login',
    JSON.stringify({
      codeVerifier: start.codeVerifier,
      state: start.state,
      nonce: start.nonce,
      returnTo,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    },
  );
  return NextResponse.redirect(start.url);
}
