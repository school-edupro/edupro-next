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
    return x.wasOut
      ? `Revoked: families stopped seeing the marks${x.from ? ` (published ${when(x.from)})` : ''}`
      : `Withdrawn before publishing${x.from ? ` (it was for ${when(x.from)})` : ''}`;
  return `${String(x.toldCount ?? 0)} families told`;
};

/**
 * Results to families (docs/design/57, part 4), the DPS "Adm Unlock": from a date and time the
 * candidate portal shows each part's marks, the total and %. Changed or withdrawn freely until it
 * passes; once published, revoked or moved with a reason (a later time hides the marks again until
 * then, docs/design/59), and the families may be told by email, SMS and WhatsApp. Every step is in the
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
  // once published: one action at a time (revoke, move, tell), each confirmed
  const [mode, setMode] = useState<'revoke' | 'move' | 'tell' | null>(null);
  const close = () => {
    setMode(null);
    setReason('');
    setAt('');
  };
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
      if (r.ok) close();
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
              <Badge tone="success">Published</Badge> Families see the marks in the admission portal
              since {when(release.at)}
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
      {canEdit && !out ? (
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
      {canEdit && out && mode === null ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          <button
            type="button"
            className="ep-btn ep-btn--danger"
            disabled={pending}
            onClick={() => setMode('revoke')}
          >
            Revoke published marks
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending}
            onClick={() => setMode('move')}
          >
            Move the time
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending || marked === 0}
            onClick={() => setMode('tell')}
          >
            Tell the families
          </button>
        </div>
      ) : null}
      {canEdit && out && mode === 'revoke' ? (
        <div className="ep-alert ep-alert--warning" role="group" aria-labelledby="rs-rev-h">
          <div style={{ display: 'grid', gap: 'var(--sp-2)', width: '100%' }}>
            <p id="rs-rev-h" style={{ margin: 0 }}>
              <strong>Revoke the published marks?</strong> Families stop seeing them in the
              admission portal at once. You can publish them again later with a new time.
            </p>
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Reason for revoking (needed)</span>
              <input
                className="ep-input"
                maxLength={300}
                value={reason}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <button
                type="button"
                className="ep-btn ep-btn--danger"
                disabled={pending || why.length < 3}
                onClick={() =>
                  run(async () => {
                    const r = await withdrawResultsRelease(place, why);
                    if (r.ok) close();
                    return r.ok
                      ? {
                          ok: true as const,
                          text: 'Revoked: families no longer see the marks. Set a time to publish them again.',
                        }
                      : r;
                  })
                }
              >
                Revoke now
              </button>
              <button type="button" className="ep-btn ep-btn--ghost" onClick={close}>
                Cancel
              </button>
            </span>
          </div>
        </div>
      ) : null}
      {canEdit && out && mode === 'move' ? (
        <div className="ep-alert ep-alert--info" role="group" aria-labelledby="rs-move-h">
          <div style={{ display: 'grid', gap: 'var(--sp-2)', width: '100%' }}>
            <p id="rs-move-h" style={{ margin: 0 }}>
              <strong>Move the time.</strong> A later time hides the marks from the families until
              then; they are told again only when you press Tell the families.
            </p>
            <div className="ep-lead-filter" style={{ margin: 0 }}>
              <label className="ep-field">
                <span className="ep-field__label">New time (India time)</span>
                <input
                  className="ep-input"
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                />
              </label>
              <label className="ep-field" style={{ minWidth: '16rem' }}>
                <span className="ep-field__label">Reason (needed)</span>
                <input
                  className="ep-input"
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending || !at || why.length < 3}
                onClick={() => release_(`${at}:00+05:30`)}
              >
                Move to this time
              </button>
              <button type="button" className="ep-btn ep-btn--ghost" onClick={close}>
                Cancel
              </button>
            </span>
          </div>
        </div>
      ) : null}
      {canEdit && out && mode === 'tell' ? (
        <div className="ep-alert ep-alert--warning" role="alert">
          <span>
            Send the result to {marked} {marked === 1 ? 'family' : 'families'} by email, SMS and
            WhatsApp now?{' '}
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={pending}
              onClick={() => {
                close();
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
            <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={close}>
              Cancel
            </button>
          </span>
        </div>
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
