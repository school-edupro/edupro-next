import { redirect } from 'next/navigation';

/**
 * The decision a form carries (approve / reject and the like). It must arrive exactly once and be
 * one of the allowed words; anything else stops with a message. A decision is never assumed: a form
 * that sends nothing, something else, or two answers changes nothing.
 */
export function decisionOf<T extends string>(
  fd: FormData,
  field: string,
  allowed: readonly T[],
  back: string,
): T {
  const all = fd
    .getAll(field)
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (all.length === 1 && (allowed as readonly string[]).includes(all[0]!)) return all[0] as T;
  const got = all.length ? all.join(' and ') : 'nothing';
  redirect(
    `${back}${back.includes('?') ? '&' : '?'}error=validation-failed&detail=${encodeURIComponent(
      `No decision was taken: press ${allowed.join(' or ')} again (the form sent ${got}).`,
    )}`,
  );
}
