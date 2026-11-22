import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { logoutUrl } from '@/lib/oidc';
import { clearSession, readSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await readSession();
  // the admin app opened as an employee (0188): signing out also closes that session at the API
  const imp = session?.impersonation;
  if (session && (imp?.mode === 'view' || imp?.mode === 'act')) {
    await fetch(`${env.apiBaseUrl}/api/v1/access/portal-as/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
  await clearSession();
  // One Auth's sign-out only for a session One Auth made: a code or the developer sign-in has none there, and One
  // Auth refuses such a sign-out (invalid_client); those just end here and go back to the sign-in page
  const idp = session?.via === 'oneauth' ? await logoutUrl().catch(() => null) : null;
  return NextResponse.redirect(idp ?? new URL('/login', req.url), { status: 303 });
}
