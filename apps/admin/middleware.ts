import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/dev',
  '/healthz',
];

/**
 * Redirects unauthenticated browsers to /login. Session validity is checked server-side in the layout;
 * here we only look for the cookie's presence to keep the middleware cheap.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next();
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/assets') ||
    pathname === '/favicon.ico'
  )
    return NextResponse.next();

  if (!req.cookies.get('edupro_session')) {
    const login = req.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(login);
  }
  // Expose the path to server layouts for the active navigation state.
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
