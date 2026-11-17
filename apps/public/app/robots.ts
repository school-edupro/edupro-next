import type { MetadataRoute } from 'next';

/**
 * The public sites are open to search engines, but not a certificate check (a page for people holding a certificate)
 * nor this app's own calls (17 Nov 2026).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/*/verify', '/api/'] }] };
}
