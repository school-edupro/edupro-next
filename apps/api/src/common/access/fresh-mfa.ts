import type { AuthenticatedUser } from '../http/request-context';

/**
 * A recent multi-factor sign-in (step-up, S5-01): the token proves MFA and, when the identity provider gives the time
 * of the sign-in, it lies within the freshness window. Without that time the MFA claim alone is accepted.
 */
export function isFreshMfa(
  user: Pick<AuthenticatedUser, 'mfa' | 'authTime'>,
  freshnessMinutes: number,
): boolean {
  if (!user.mfa) return false;
  if (user.authTime === undefined) return true;
  const ageSeconds = Math.floor(Date.now() / 1000) - user.authTime;
  return ageSeconds <= freshnessMinutes * 60;
}
