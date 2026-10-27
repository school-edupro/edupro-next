'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ResultsRelease as Release } from '@/lib/admission-results';
import {
  setResultsRelease,
  tellResults,
  withdrawResultsRelease,
} from '@/lib/admission-results-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * Results to families (docs/design/57, part 4), the DPS "Adm Unlock": from a date and time the
 * candidate portal shows each part's marks, the total and %. Changed or withdrawn until it passes;
 * once out, the families may be told by email, SMS and WhatsApp.
 */
export function ResultsRelease({
  place,
  release,
  marked,
  canEdit,
}: {
  place: { cycleId: string; classId: string; stageId: string };
  release: Release | null;
  /** candidates with marks (or absent): who would be told */
  marked: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState('');
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const run = (job: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await job();
      setMsg(r.ok ? { tone: 'success', text: r.text } : { tone: 'danger', text: r.error });
      if (r.ok) router.refresh();
    });
  const release_ = (iso: string) =>
    run(async () => {
      const r = await setResultsRelease(place, iso);
      return r.ok
        ? {
            ok: true as const,
            text: r.data.release?.passed
              ? 'The results are out: families see them in the admission portal.'
              : `The results go out on ${when(iso)}.`,
          }
        : r;
    });

  return (
    <section className="ep-card" aria-labelledby="rs-rel-h" style={{ marginBottom: 'var(--sp-4)' }}>
      <h2 id="rs-rel-h" className="ep-card__title">
        Results to families
      </h2>
      <p style={{ marginTop: 0 }}>
        {release ? (
          release.passed ? (
            <>
              <Badge tone="success">Out</Badge> Families see the marks in the admission portal since{' '}
              {when(release.at)}
              {release.by ? ` (set by ${release.by})` : ''}.
              {release.toldAt
                ? ` Told ${String(release.toldCount ?? 0)} families on ${when(release.toldAt)}.`
                : ''}
            </>
          ) : (
            <>
              <Badge tone="info">Set</Badge> The marks go out to families on {when(release.at)}
              {release.by ? ` (set by ${release.by})` : ''}. Until then they see nothing.
            </>
          )
        ) : (
          <>
            <Badge tone="neutral">Not released</Badge> Families do not see these marks. Choose when
            they may.
          </>
        )}
      </p>
      {canEdit && !release?.passed ? (
        <div className="ep-lead-filter">
          <label className="ep-field">
            <span className="ep-field__label">Release on (India time)</span>
            <input
              className="ep-input"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || !at}
              onClick={() => release_(`${at}:00+05:30`)}
            >
              {release ? 'Change the time' : 'Release at this time'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() => release_(new Date().toISOString())}
            >
              Release now
            </button>
            {release ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await withdrawResultsRelease(place);
                    return r.ok ? { ok: true as const, text: 'The release is withdrawn.' } : r;
                  })
                }
              >
                Withdraw
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {canEdit && release?.passed ? (
        asking ? (
          <div className="ep-alert ep-alert--warning" role="alert">
            <span>
              Send the result to {marked} {marked === 1 ? 'family' : 'families'} by email, SMS and
              WhatsApp now?{' '}
              <button
                type="button"
                className="ep-btn ep-btn--primary ep-btn--sm"
                disabled={pending}
                onClick={() => {
                  setAsking(false);
                  run(async () => {
                    const r = await tellResults(place);
                    return r.ok
                      ? {
                          ok: true as const,
                          text: `${String(r.data.told)} families told (the messages go out with the workers).`,
                        }
                      : r;
                  });
                }}
              >
                Send
              </button>{' '}
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => setAsking(false)}
              >
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending || marked === 0}
            onClick={() => setAsking(true)}
          >
            Tell the families
          </button>
        )
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
