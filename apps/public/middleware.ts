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
/** The certificate check and its call: for people (17 Nov 2026). */
const VERIFY = /^\/(?:[^/]+\/verify(?:\/|$)|api\/certificate-check$)/;
/**
 * Crawlers and agents of AI companies that say who they are: refused on the certificate check. (One that hides who
 * it is meets the human check and the limits instead.)
 */
const AI_AGENTS =
  /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|CCBot|Bytespider|Amazonbot|cohere-ai|Diffbot|YouBot|meta-externalagent|meta-externalfetcher|FacebookBot|ImagesiftBot|Omgilibot|Timpibot|PetalBot|AI2Bot|Applebot-Extended/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const verify = VERIFY.test(pathname);
  if (verify && AI_AGENTS.test(req.headers.get('user-agent') ?? ''))
    return new NextResponse('The certificate check is for people only.', {
      status: 403,
      headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    });
  const headers = new Headers(req.headers);
  headers.set('x-pathname', pathname);
  if (process.env.NODE_ENV !== 'production' || NOT_PAGE.test(pathname)) {
    const res = NextResponse.next({ request: { headers } });
    if (verify) res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res;
  }
  const nonce = btoa(crypto.randomUUID());
  const policy = pageCsp(nonce);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  if (verify) res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
