/**
 * This app's Content Security Policy (production builds; development needs Next's eval and HMR): pages get
 * a nonce per request (middleware.ts), route handlers the fixed policy (next.config.ts).
 */
const BASE = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-src 'none'",
];

/** A page: its scripts carry this request's nonce (Next.js puts it on its own); the service worker is 'self'. */
export const pageCsp = (nonce: string) =>
  [...BASE, `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, "worker-src 'self'"].join('; ');

/** A route handler (a file, a print page with its script from this site): scripts from this site only. */
export const routeCsp = () => [...BASE, "script-src 'self'"].join('; ');
