import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import { env } from '@/lib/env';

/**
 * My children (0425): a staff member who is also a parent here opens the family website signed in — a one-time link
 * from the API (60 seconds, used once); the family website then offers Admin app to come back. Without a link, the
 * family website's sign-in.
 */
export async function POST() {
  const family = env.parentAppUrl.replace(/\/+$/, '');
  try {
    const r = await apiFetch<{ url: string }>('/auth/web-hop', {
      method: 'POST',
      body: JSON.stringify({ app: 'parent', from: 'admin', to: '/' }),
    });
    if (r.url.startsWith(`${family}/`)) return NextResponse.redirect(r.url, 303);
  } catch {
    // signed out here, or no longer a parent in this school: the family website asks for a sign-in
  }
  return NextResponse.redirect(`${family}/login`, 303);
}
