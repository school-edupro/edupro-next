'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { DrawTwin } from '@/lib/admission-draw';
import { setDrawTwins } from '@/lib/admission-draw-actions';

const STATE: Record<DrawTwin['state'], [string, 'info' | 'success' | 'neutral']> = {
  found: ['Found: one slip', 'info'],
  paired: ['Confirmed: one slip', 'success'],
  split: ['Split: a slip each', 'neutral'],
};

/**
 * Twins of a points total (docs/design/60): found by the same date of birth and family mobile, they
 * share one slip; the office confirms them, or splits them onto a slip each (and back).
 */
export function DrawTwins({
  cycleId,
  classId,
  twins,
  names,
  canEdit,
}: {
  cycleId: string;
  classId: string;
  twins: DrawTwin[];
  names: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (ids: string[], state: 'paired' | 'split') =>
    start(async () => {
      setError(null);
      const r = await setDrawTwins({ cycleId, classId, ids, state });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <ul
        style={{
          margin: 0,
          paddingLeft: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--sp-2)',
        }}
      >
        {twins.map((t) => {
          const who = t.ids.map((id) => names[id] ?? id).join(' & ');
          return (
            <li
              key={t.ids.join(':')}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-2)',
                alignItems: 'center',
              }}
            >
              <strong>{who}</strong>
              <Badge tone={STATE[t.state][1]}>{STATE[t.state][0]}</Badge>
              {canEdit && t.state !== 'paired' ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  disabled={pending}
                  onClick={() => set(t.ids, 'paired')}
                >
                  {t.state === 'split' ? 'Put on one slip' : 'Confirm one slip'}
                  <span className="ep-sr-only"> for {who}</span>
                </button>
              ) : null}
              {canEdit && t.state !== 'split' ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={() => set(t.ids, 'split')}
                >
                  Split<span className="ep-sr-only"> {who}</span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
