import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

const SITE = {
  teacher: (process.env.TEACHER_APP_URL ?? 'http://localhost:3002').replace(/\/+$/, ''),
  admin: (process.env.ADMIN_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
};

/**
 * Switch on the family website (0425): the staff or admin website, signed in — a one-time link from the API, for a
 * session that was opened from the staff or admin website. Without one, that website's sign-in.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const to = String(form.get('to') ?? '');
  if (to !== 'teacher' && to !== 'admin') return NextResponse.redirect(new URL('/', req.url), 303);
  try {
    const r = await bff.api.fetch<{ url: string }>('/auth/web-hop', {
      method: 'POST',
      body: JSON.stringify({ app: to, to: '/' }),
    });
    if (r.url.startsWith(`${SITE[to]}/`)) return NextResponse.redirect(r.url, 303);
  } catch {
    // no longer staff there, or this session was not opened from the staff side: that website asks for a sign-in
  }
  return NextResponse.redirect(`${SITE[to]}/login`, 303);
}
