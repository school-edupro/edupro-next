import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

const SITE = {
  parent: (process.env.PARENT_APP_URL ?? 'http://localhost:3001').replace(/\/+$/, ''),
  admin: (process.env.ADMIN_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
};

/**
 * Switch (0424, 0425): the admin website, or the family website on one child, signed in with this login — a one-time
 * link from the API (60 seconds, used once). Without one, that website's sign-in.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const to = String(form.get('to') ?? '');
  if (to !== 'parent' && to !== 'admin') return NextResponse.redirect(new URL('/', req.url), 303);
  const child = String(form.get('child') ?? '');
  // the family website on that child (its child switch remembers the pick)
  const page = to === 'parent' && /^\d{1,18}$/.test(child) ? `/api/child?id=${child}&back=/` : '/';
  try {
    const r = await bff.api.fetch<{ url: string }>('/auth/web-hop', {
      method: 'POST',
      body: JSON.stringify({ app: to, ...(to === 'parent' ? { from: 'teacher' } : {}), to: page }),
    });
    if (r.url.startsWith(`${SITE[to]}/`)) return NextResponse.redirect(r.url, 303);
  } catch {
    // signed out here, or no longer a parent / staff there: that website asks for a sign-in
  }
  return NextResponse.redirect(`${SITE[to]}/login`, 303);
}
