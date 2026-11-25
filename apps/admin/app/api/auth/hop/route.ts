import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { writeContext, writeSession } from '@/lib/session';
import { recordSignIn } from '@/lib/sign-in';

/**
 * The family website's way back to the admin website (0425): a staff member who is also a parent opened the family
 * website with My children here; Admin app there brings them back signed in. The one-time code is turned in at the
 * API for this website's own session, in the school they were working in.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') ?? '';
  const failed = () => NextResponse.redirect(new URL('/login?error=handoff', req.url));
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(code)) return failed();
  try {
    const r = await fetch(`${env.apiBaseUrl}/api/v1/auth/web-hop/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, app: 'admin' }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!r.ok) return failed();
    const t = (await r.json()) as {
      accessToken: string;
      sub: string;
      displayName: string;
      schoolId: string;
      expiresAt: number;
      to: string;
    };
    await writeSession({
      sub: t.sub,
      accessToken: t.accessToken,
      expiresAt: t.expiresAt,
      displayName: t.displayName,
      via: 'code',
    });
    await writeContext({ schoolId: t.schoolId });
    await recordSignIn(req, t.accessToken, 'otp');
    const to = t.to.startsWith('/') && !t.to.startsWith('//') ? t.to : '/';
    return NextResponse.redirect(new URL(to, req.url));
  } catch {
    return failed();
  }
}
