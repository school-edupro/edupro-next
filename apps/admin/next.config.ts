import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/** Security headers per the foundation design section 11. CSP nonces are added with middleware in Sprint 2. */
// Content Security Policy for production builds (S5-10 review item 3). Development keeps Next's eval/hmr
// requirements; Google Fonts serves the Devanagari face for Hindi.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Content-Security-Policy', value: csp }]
    : []),
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@edupro/ui'],
  output: 'standalone',
  // the help centre reads content/help/*.md at request time (Sprint 22)
  outputFileTracingIncludes: {
    '/help': ['./content/help/**'],
    '/help/[slug]': ['./content/help/**'],
  },
  // S6-05: CSV imports are posted through a server action; the API accepts up to 2 MB of CSV text.
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      // proof documents preview inside the approvals panel: framed by this site's own pages only
      {
        source: '/api/profile-proofs/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Content-Security-Policy',
                  value: csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
