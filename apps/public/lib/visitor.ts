import { headers } from 'next/headers';

/**
 * The visitor's address, passed on to the API (17 Nov 2026). The public pages call the API from this server, so
 * without it every visitor came with this server's address and shared one rate limit. The address is the last one
 * the ingress in front of this app added to X-Forwarded-For (a visitor cannot set that one), or X-Real-IP; none in
 * development.
 */
export function visitorIpOf(h: Headers): string | null {
  const chain = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const ip = chain[chain.length - 1] ?? h.get('x-real-ip')?.trim() ?? '';
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** The headers that carry the visitor's address to the API (from a page or a route handler of this request). */
export async function visitorHeaders(): Promise<Record<string, string>> {
  try {
    const ip = visitorIpOf(await headers());
    return ip ? { 'X-Forwarded-For': ip } : {};
  } catch {
    // outside a request (build time)
    return {};
  }
}
