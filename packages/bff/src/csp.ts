import { NextResponse, type NextRequest } from 'next/server';

/** Not a page: a route handler, Next's own files, a file under public/ (sw.js, icons, the manifest). */
const NOT_PAGE = /^\/(?:api|_next)\/|\.[a-z0-9]+$/i;

/**
 * Lets a request through to its page with the app's Content Security Policy (production builds; development
 * needs Next's eval and HMR): a nonce of its own per request, set on the request — Next.js reads the policy
 * there and puts the nonce on its own scripts — and on the response. Without it the fixed `script-src 'self'`
 * blocked Next's inline scripts and every page stayed blank. What is not a page (and `skip`: routes with a
 * policy of their own) goes through as it is; route handlers get their fixed policy from next.config.ts.
 */
export function nextWithCsp(
  req: NextRequest,
  pageCsp: (nonce: string) => string,
  headers: Headers = new Headers(req.headers),
  skip?: RegExp,
): NextResponse {
  const { pathname } = req.nextUrl;
  if (process.env.NODE_ENV !== 'production' || NOT_PAGE.test(pathname) || skip?.test(pathname))
    return NextResponse.next({ request: { headers } });
  const nonce = btoa(crypto.randomUUID());
  const policy = pageCsp(nonce);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  return res;
}
