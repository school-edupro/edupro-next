import { NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

const FAMILY = (process.env.PARENT_APP_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * My children (0424): a staff member who is also a parent here opens the family website signed in — a one-time
 * link from the API (60 seconds, used once). Without one (the link could not be made), the family website's sign-in.
 */
export async function POST() {
  try {
    const r = await bff.api.fetch<{ url: string }>('/auth/web-hop', {
      method: 'POST',
      body: JSON.stringify({ to: '/' }),
    });
    if (r.url.startsWith(`${FAMILY}/`)) return NextResponse.redirect(r.url, 303);
  } catch {
    // signed out here, or no longer a parent in this school: the family website asks for a sign-in
  }
  return NextResponse.redirect(`${FAMILY}/login`, 303);
}
