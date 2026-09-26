import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { writeSession } from '@/lib/session';

/**
 * Development-only sign-in that mirrors the API's dev bypass: POST { sub } creates a session whose access
 * token is "dev:<sub>". Returns 404 unless AUTH_DEV_BYPASS=1 and NODE_ENV is not production.
 */
export async function POST(req: NextRequest) {
  if (!env.devBypass) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const form = await req.formData();
  const sub = String(form.get('sub') ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sub)) return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  await writeSession({
    sub: `dev:${sub}`,
    accessToken: `dev:${sub}`,
    expiresAt: Math.floor(Date.now() / 1000) + 12 * 3600,
    displayName: sub,
  });
  return NextResponse.redirect(new URL('/', req.url), { status: 303 });
}
