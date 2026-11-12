import type { NextConfig } from 'next';
import { routeCsp } from './csp';

/**
 * Security headers (foundation design section 11; Sprint 21 VAPT readiness). The Content Security Policy
 * applies to production builds only: development needs Next's eval and HMR. Pages get it with a nonce per
 * request from middleware.ts; route handlers the fixed one (csp.ts).
 */

const common = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];
const production = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@edupro/ui', '@edupro/bff'],
  output: 'standalone',
  // a sheet of homework carries its attachments (the school sets the size of each, up to 25 MB)
  experimental: { serverActions: { bodySizeLimit: '32mb' } },
  async headers() {
    return [
      {
        // pages get the Content Security Policy with a nonce per request from middleware.ts
        source: '/(.*)',
        headers: common,
      },
      // route handlers (files, print pages): scripts from this site only
      ...(production
        ? [
            {
              source: '/api/:path*',
              headers: [{ key: 'Content-Security-Policy', value: routeCsp() }],
            },
          ]
        : []),
    ];
  },
};

export default nextConfig;
