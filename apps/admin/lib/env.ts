/** Server-side environment for the admin BFF. Never import from client components. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  get apiBaseUrl(): string {
    return process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:4000';
  },
  get sessionSecret(): string {
    const secret = required('SESSION_SECRET');
    if (process.env.NODE_ENV === 'production' && secret.startsWith('change-me')) {
      throw new Error('SESSION_SECRET must be set to a real value in production');
    }
    return secret;
  },
  get oidc() {
    return {
      issuer: required('ONEAUTH_ISSUER'),
      clientId: required('ONEAUTH_CLIENT_ID'),
      clientSecret: required('ONEAUTH_CLIENT_SECRET'),
      redirectUri: required('ONEAUTH_REDIRECT_URI'),
      /** ACR value that requests multi-factor authentication from One Auth (step-up). */
      mfaAcr: process.env.ONEAUTH_MFA_ACR ?? 'mfa',
    };
  },
  get devBypass(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_BYPASS === '1';
  },
};
