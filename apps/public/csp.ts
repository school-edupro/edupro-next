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
];
/** Google reCAPTCHA's box is a frame from Google (the public certificate check, 17 Nov 2026); nothing else frames. */
const RECAPTCHA_FRAMES =
  'https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/';

/** A page: its scripts carry this request's nonce (Next.js puts it on its own); the service worker is 'self'. */
export const pageCsp = (nonce: string) =>
  [
    ...BASE,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "worker-src 'self'",
    `frame-src ${RECAPTCHA_FRAMES}`,
  ].join('; ');

/** A route handler (a file, a print page with its script from this site): scripts from this site only. */
export const routeCsp = () => [...BASE, "script-src 'self'", "frame-src 'none'"].join('; ');
