import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { routeCsp } from './csp';

/**
 * Security headers per the foundation design section 11. The Content Security Policy (production builds):
 * pages get one with a nonce per request from middleware.ts; route handlers get the fixed one below.
 */
const production = process.env.NODE_ENV === 'production';
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // the gate takes a walk-in visitor's photo live, so this site itself may ask for the camera
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@edupro/ui', '@edupro/bff'],
  output: 'standalone',
  // the help centre reads content/help/*.md at request time (Sprint 22)
  outputFileTracingIncludes: {
    '/help': ['./content/help/**'],
    '/help/[slug]': ['./content/help/**'],
  },
  // S6-05: CSV imports are posted through a server action; the API accepts up to 2 MB of CSV text.
  experimental: { serverActions: { bodySizeLimit: '32mb' } },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      // route handlers (files, print pages): scripts from this site only
      ...(production
        ? [
            {
              source: '/api/((?!profile-proofs|report-cards/preview).*)',
              headers: [{ key: 'Content-Security-Policy', value: routeCsp() }],
            },
          ]
        : []),
      // framed by this site's own pages only: proof documents in the approvals panel, and the
      // report-card preview (the card designer and a release's preview panel)
      ...['/api/profile-proofs/:path*', '/api/report-cards/preview'].map((source) => ({
        source,
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          ...(production ? [{ key: 'Content-Security-Policy', value: routeCsp(true) }] : []),
        ],
      })),
    ];
  },
};

export default withNextIntl(nextConfig);
