import type { NextConfig } from 'next';

/**
 * Security headers (foundation design section 11; Sprint 21 VAPT readiness). The Content Security Policy
 * applies to production builds only: development needs Next's eval and HMR. The pay routes render a gateway hand-off page with an inline script (Razorpay checkout or an auto-posted form), so they carry a policy that allows that script and the gateway origins; every other page is 'self' only.
 */
const base = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
];
const csp = [...base, "script-src 'self'", "form-action 'self'", "frame-src 'none'"].join('; ');
const GATEWAYS = [
  'https://checkout.razorpay.com',
  'https://api.razorpay.com',
  'https://*.razorpay.com',
  'https://secure.payu.in',
  'https://test.payu.in',
  'https://*.ccavenue.com',
  'https://*.sbiepay.sbi',
  'https://*.atomtech.in',
];
const cspPay = [
  // a directive given twice counts once: the pay pages replace connect-src with their own
  ...base.filter((d) => !d.startsWith('connect-src')),
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://pgtest.atomtech.in https://psa.atomtech.in",
  // Atom's checkout script calls its own servers
  "connect-src 'self' https://*.atomtech.in",
  `form-action 'self' ${GATEWAYS.join(' ')}`,
  `frame-src ${GATEWAYS.join(' ')}`,
].join('; ');

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
  async headers() {
    return [
      {
        source: '/(fees|consents)/(pay|pay-misc)',
        headers: [
          ...common,
          ...(production ? [{ key: 'Content-Security-Policy', value: cspPay }] : []),
        ],
      },
      {
        source: '/((?!fees/pay|fees/pay-misc|consents/pay).*)',
        headers: [
          ...common,
          ...(production ? [{ key: 'Content-Security-Policy', value: csp }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
