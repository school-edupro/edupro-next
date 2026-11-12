import { NextResponse, type NextRequest } from 'next/server';
import { pageCsp } from './csp';

/** Not a page: a route handler, Next's own files, a file under public/. */
const NOT_PAGE = /^\/(?:api|_next)\/|\.[a-z0-9]+$/i;

/**
 * The admission portal's shell marks the page it is on: the path travels as `x-pathname` (docs/design/42).
 * Every page goes through with the Content Security Policy and a nonce of its own per request (production
 * builds; development needs Next's eval and HMR): Next.js reads the policy from the request and puts the nonce
 * on its own scripts. Without it the fixed `script-src 'self'` blocked them and the pages stayed blank.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname);
  if (process.env.NODE_ENV !== 'production' || NOT_PAGE.test(pathname))
    return NextResponse.next({ request: { headers } });
  const nonce = btoa(crypto.randomUUID());
  const policy = pageCsp(nonce);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
