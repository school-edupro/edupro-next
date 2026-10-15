import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { completeLogin } from '@/lib/oidc';
import { recordSignIn } from '@/lib/sign-in';
import { otp } from '@/lib/otp';
import { writeSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const store = await cookies();
  const raw = store.get('edupro_login')?.value;
  store.delete('edupro_login');
  if (!raw) return NextResponse.redirect(new URL('/login?error=login-expired', req.url));

  const pending = JSON.parse(raw) as {
    codeVerifier: string;
    state: string;
    nonce: string;
    returnTo: string;
  };
  try {
    const result = await completeLogin(req.nextUrl, pending);
    const safeReturn =
      pending.returnTo.startsWith('/') && !pending.returnTo.startsWith('//')
        ? pending.returnTo
        : '/';
    // a school that asks a code after One Auth: the session waits for the code (/login/otp)
    const held = await otp.afterOneAuth(req, result.accessToken, safeReturn);
    if (held) return held;
    await writeSession({
      sub: result.sub,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      displayName: result.displayName,
    });
    await recordSignIn(req, result.accessToken, 'oidc');
    return NextResponse.redirect(new URL(safeReturn, req.url));
  } catch {
    return NextResponse.redirect(new URL('/login?error=login-failed', req.url));
  }
}
