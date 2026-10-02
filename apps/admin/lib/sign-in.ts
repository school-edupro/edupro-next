import { env } from '@/lib/env';

/** Tells the API a sign-in happened (for "last sign-in" in the user card); never fails the sign-in. */
export async function recordSignIn(req: Request, token: string, method: 'oidc' | 'dev') {
  try {
    await fetch(`${env.apiBaseUrl}/api/v1/me/sign-in`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        method,
        app: 'admin',
        userAgent: req.headers.get('user-agent') ?? undefined,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // the sign-in itself must not depend on this
  }
}
