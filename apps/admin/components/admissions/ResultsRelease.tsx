'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ResultsRelease as Release, ResultsReleaseLog } from '@/lib/admission-results';
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

/** A step of the history in words. */
const stepWords = (x: ResultsReleaseLog) => {
  const out = x.wasOut ? ' (families could see the marks)' : '';
  if (x.what === 'set') return `Set for ${x.to ? when(x.to) : '-'}`;
  if (x.what === 'moved')
    return `Moved${x.from ? ` from ${when(x.from)}` : ''} to ${x.to ? when(x.to) : '-'}${out}`;
  if (x.what === 'taken_back')
    return `Taken back${x.from ? ` (it was for ${when(x.from)})` : ''}${out}`;
  return `${String(x.toldCount ?? 0)} families told`;
};

/**
 * Results to families (docs/design/57, part 4), the DPS "Adm Unlock": from a date and time the
 * candidate portal shows each part's marks, the total and %. Changed or withdrawn freely until it
 * passes; once out, moved or taken back with a reason (a later time hides the marks again until then,
 * docs/design/59), and the families may be told by email, SMS and WhatsApp. Every step is in the
 * history.
 */
export function ResultsRelease({
  place,
  release,
  log,
  marked,
  canEdit,
}: {
  place: { cycleId: string; classId: string; stageId: string };
  release: Release | null;
  log: ResultsReleaseLog[];
  /** candidates with marks (or absent): who would be told */
  marked: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const out = Boolean(release?.passed);
  const why = reason.trim();
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
      const r = await setResultsRelease(place, iso, out ? why : undefined);
      if (r.ok) setReason('');
      return r.ok
        ? {
            ok: true as const,
            text: r.data.release?.passed
              ? 'The results are out: families see them in the admission portal.'
              : `The results go out on ${when(iso)}${out ? '; until then families no longer see them' : ''}.`,
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
      {canEdit ? (
        <div className="ep-lead-filter">
          <label className="ep-field">
            <span className="ep-field__label">
              {out ? 'Move to (India time)' : 'Release on (India time)'}
            </span>
            <input
              className="ep-input"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          {out ? (
            <label className="ep-field" style={{ minWidth: '16rem' }}>
              <span className="ep-field__label">Reason (needed: the results are out)</span>
              <input
                className="ep-input"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          ) : null}
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || !at || (out && why.length < 3)}
              onClick={() => release_(`${at}:00+05:30`)}
            >
              {out ? 'Move to this time' : release ? 'Change the time' : 'Release at this time'}
            </button>
            {!out ? (
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={() => release_(new Date().toISOString())}
              >
                Release now
              </button>
            ) : null}
            {release ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                disabled={pending || (out && why.length < 3)}
                onClick={() =>
                  run(async () => {
                    const r = await withdrawResultsRelease(place, out ? why : undefined);
                    if (r.ok) setReason('');
                    return r.ok
                      ? {
                          ok: true as const,
                          text: out
                            ? 'Taken back: families no longer see the marks.'
                            : 'The release is withdrawn.',
                        }
                      : r;
                  })
                }
              >
                {out ? 'Take back' : 'Withdraw'}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {canEdit && out ? (
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          A later time hides the marks from the families until then; they are told again only when
          you press Tell the families.
        </p>
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
      {log.length ? (
        <details style={{ marginTop: 'var(--sp-3)' }}>
          <summary>History ({log.length})</summary>
          <ul
            className="ep-field__help"
            style={{ margin: 'var(--sp-2) 0 0', paddingLeft: '1.2rem' }}
          >
            {log.map((x, i) => (
              <li key={`${x.at}-${String(i)}`}>
                {when(x.at)} · {x.by ?? 'someone'}: {stepWords(x)}
                {x.reason ? ` · reason: ${x.reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
