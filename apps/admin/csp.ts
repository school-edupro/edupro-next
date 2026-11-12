/**
 * This app's Content Security Policy (production builds; development needs Next's eval and HMR): pages get
 * a nonce per request (middleware.ts), route handlers the fixed policy (next.config.ts).
 */
// Google Fonts serves the Devanagari face for Hindi; the stoppage picker (Transport setup) shows
// OpenStreetMap tiles
const BASE = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

/** A page: its scripts carry this request's nonce (Next.js puts it on its own); never framed. */
export const pageCsp = (nonce: string) =>
  [
    ...BASE,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "worker-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

/**
 * A route handler (a file, a print page): scripts from this site only. Framed by this site's own pages:
 * proof documents in the approvals panel and the report-card preview.
 */
export const routeCsp = (framedHere = false) =>
  [...BASE, "script-src 'self'", `frame-ancestors ${framedHere ? "'self'" : "'none'"}`].join('; ');
