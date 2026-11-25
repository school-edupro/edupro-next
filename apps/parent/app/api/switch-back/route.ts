import { NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

const SITE = {
  teacher: (process.env.TEACHER_APP_URL ?? 'http://localhost:3002').replace(/\/+$/, ''),
  admin: (process.env.ADMIN_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
};

/**
 * Staff app / Admin app on the family website (0425): back to the website this session was opened from (My
 * children), signed in — a one-time link from the API. Without one, that website's sign-in.
 */
export async function POST() {
  const from = (await bff.session.read())?.cameFrom;
  if (from !== 'teacher' && from !== 'admin')
    return NextResponse.redirect(
      new URL('/', process.env.PARENT_APP_URL ?? 'http://localhost:3001'),
      303,
    );
  try {
    const r = await bff.api.fetch<{ url: string }>('/auth/web-hop', {
      method: 'POST',
      body: JSON.stringify({ app: from, to: '/' }),
    });
    if (r.url.startsWith(`${SITE[from]}/`)) return NextResponse.redirect(r.url, 303);
  } catch {
    // no longer staff there, or this session is older than the way back: that website asks for a sign-in
  }
  return NextResponse.redirect(`${SITE[from]}/login`, 303);
}
