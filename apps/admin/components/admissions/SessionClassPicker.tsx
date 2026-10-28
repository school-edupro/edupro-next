'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

type Cycle = {
  id: string;
  name: string;
  count?: number;
  classes: Array<{ id: string; name: string; count?: number }>;
};

/**
 * A report's session and class (docs/design/61): each choice opens at once and the classes follow the
 * session, each with how many registrations it has; the page's other filters are kept.
 */
export function SessionClassPicker({
  cycles,
  cycleId,
  classId,
  path,
  keep = {},
  noun = 'registration',
}: {
  cycles: Cycle[];
  cycleId: string;
  classId: string;
  /** the page, e.g. /admissions/score-report */
  path: string;
  /** the other filters to keep on a change */
  keep?: Record<string, string>;
  noun?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cycle = cycles.find((y) => y.id === cycleId);
  const words = (n?: number) => (n ? ` · ${String(n)} ${noun}${n === 1 ? '' : 's'}` : '');
  const go = (c: string, k?: string) =>
    start(() => {
      const q = new URLSearchParams({ ...keep, cycleId: c });
      if (k) q.set('classId', k);
      router.push(`${path}?${q.toString()}`);
    });

  return (
    <>
      <label className="ep-field">
        <span className="ep-field__label">Session</span>
        <select
          className="ep-select"
          value={cycleId}
          disabled={pending}
          onChange={(e) => go(e.target.value)}
        >
          {cycles.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {words(y.count)}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Class</span>
        <select
          className="ep-select"
          value={classId}
          disabled={pending}
          onChange={(e) => go(cycleId, e.target.value)}
        >
          {(cycle?.classes ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {words(k.count)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
