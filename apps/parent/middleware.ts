import { bff } from '@/lib/bff';
import { pageCsp } from './csp';

// The gateway posts the payment result here from its own site, where the browser sends no session cookie:
// the route needs none (the API checks the gateway's signature), so it must not send the parent to sign-in.
// Pages get the Content Security Policy with a nonce per request (production builds); the pay hand-offs keep
// their own (next.config.ts: the gateways' scripts).
export const middleware = bff.middleware(['/api/payments/return'], {
  page: pageCsp,
  skip: /^\/(fees|consents)\/(pay|pay-misc)$/,
});

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
