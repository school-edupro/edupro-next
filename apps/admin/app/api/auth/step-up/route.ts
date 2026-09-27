import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { startLogin } from '@/lib/oidc';

/** Step-up authentication (S5-01): a fresh multi-factor sign-in before a privileged action. */
export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/';
  const start = await startLogin(returnTo, { stepUp: true });
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
