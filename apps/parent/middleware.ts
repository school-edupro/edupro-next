import { bff } from '@/lib/bff';

// The gateway posts the payment result here from its own site, where the browser sends no session cookie:
// the route needs none (the API checks the gateway's signature), so it must not send the parent to sign-in.
export const middleware = bff.middleware(['/api/payments/return']);

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
