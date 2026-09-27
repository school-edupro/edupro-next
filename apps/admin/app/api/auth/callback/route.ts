import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { completeLogin } from '@/lib/oidc';
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
    await writeSession({
      sub: result.sub,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      displayName: result.displayName,
    });
    const safeReturn =
      pending.returnTo.startsWith('/') && !pending.returnTo.startsWith('//')
        ? pending.returnTo
        : '/';
    return NextResponse.redirect(new URL(safeReturn, req.url));
  } catch {
    return NextResponse.redirect(new URL('/login?error=login-failed', req.url));
  }
}
