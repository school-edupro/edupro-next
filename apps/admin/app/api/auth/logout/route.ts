import { NextResponse, type NextRequest } from 'next/server';
import { logoutUrl } from '@/lib/oidc';
import { clearSession, readSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const session = await readSession();
  await clearSession();
  const idp = session && !session.sub.startsWith('dev:') ? await logoutUrl().catch(() => null) : null;
  return NextResponse.redirect(idp ?? new URL('/login', req.url), { status: 303 });
}
