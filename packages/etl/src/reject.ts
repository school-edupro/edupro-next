/** A value the transform could not accept. Recorded in etl.rejects, never silently defaulted. */
export interface Reject {
  readonly kind: 'reject';
  readonly reason: string;
  readonly raw: unknown;
  /** identity, money and marks rejects block a cutover */
  readonly blocking: boolean;
}

export type Result<T> = { kind: 'ok'; value: T } | Reject;

export const ok = <T>(value: T): Result<T> => ({ kind: 'ok', value });

export const reject = (reason: string, raw: unknown, blocking = false): Reject => ({
  kind: 'reject',
  reason,
  raw,
  blocking,
});

export const isReject = <T>(r: Result<T>): r is Reject => r.kind === 'reject';

/** Unwraps or throws; for tests and for callers that already checked. */
export function unwrap<T>(r: Result<T>): T {
  if (r.kind === 'reject') throw new Error(`${r.reason}: ${String(r.raw)}`);
  return r.value;
}
