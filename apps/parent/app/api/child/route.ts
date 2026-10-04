import { NextResponse, type NextRequest } from 'next/server';
import { CHILD_COOKIE } from '@/lib/child';

/**
 * The sibling switch: remembers the chosen child for every page of the portal and goes back to the page
 * it was pressed on. The id is only a preference; each page still checks it against the family's own
 * children.
 */
export function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const back = req.nextUrl.searchParams.get('back') ?? '/';
  const safe = back.startsWith('/') && !back.startsWith('//') && !back.includes('\\') ? back : '/';
  const res = NextResponse.redirect(new URL(safe, req.nextUrl.origin), 303);
  if (/^\d{1,18}$/.test(id))
    res.cookies.set(CHILD_COOKIE, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 180,
    });
  return res;
}
