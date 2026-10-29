'use client';
import { useEffect, useState, useTransition } from 'react';
import type { NumberSeries, NumberSeriesRenumberResult } from '@/lib/admission-scores';
import { renumberNumberSeries } from '@/lib/admission-scores-actions';

/**
 * Renumber registrations already made from a series (docs/design/63): the list of old → new numbers
 * first, then Apply with a reason. Old numbers stay in each registration's history and are still found
 * by search; admitted ones and admission numbers are left alone.
 */
export function NumberSeriesRenumber({
  series,
  onDone,
  onClose,
}: {
  series: NumberSeries;
  onDone: (list: NumberSeries[], text: string) => void;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<NumberSeriesRenumberResult | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    start(async () => {
      const r = await renumberNumberSeries(series.id, false);
      if (r.ok) setPlan(r.data);
      else setError(r.error);
    });
  }, [series.id]);

  return (
    <section className="ep-card" aria-labelledby="ns-renumber-h">
      <h2 id="ns-renumber-h" className="ep-card__title">
        Renumber registrations already made · {series.name}
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Registrations of this series&apos; session{series.className ? ` (${series.className})` : ''}{' '}
        not yet admitted, whose series this is, get numbers from it in the order they registered.
        Each keeps its old number in its history and is still found by it; receipts already printed
        keep the old number.
      </p>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {!plan && !error ? <p role="status">Working out the new numbers…</p> : null}
      {plan ? (
        plan.rows.length ? (
          <>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Old and new numbers (scrolls sideways)"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Old and new registration numbers</caption>
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Now</th>
                    <th scope="col">Will be</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <a href={`/admissions/registrations/${x.id}`}>{x.candidate ?? x.from}</a>
                      </td>
                      <td>{x.from}</td>
                      <td>
                        <strong>{x.to}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.skipped ? (
              <p className="ep-field__help">
                {plan.skipped} already {plan.skipped === 1 ? 'has' : 'have'} a number from this
                series and stay as they are.
              </p>
            ) : null}
            <label className="ep-field">
              <span className="ep-field__label">Reason (needed)</span>
              <input
                className="ep-input"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </>
        ) : (
          <p role="status">
            Nothing to renumber
            {plan.skipped ? `: ${String(plan.skipped)} already in this series` : ''}.
          </p>
        )
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        {plan?.rows.length ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await renumberNumberSeries(series.id, true, reason.trim());
                if (!r.ok) return setError(r.error);
                onDone(
                  r.data.series,
                  `${String(r.data.rows.length)} registration${r.data.rows.length === 1 ? '' : 's'} renumbered; the old numbers are kept.`,
                );
              })
            }
          >
            Renumber {plan.rows.length}
          </button>
        ) : null}
        <button type="button" className="ep-btn ep-btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {plan?.rows.length && reason.trim().length < 3 ? (
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          Write the reason (3 letters or more) to renumber.
        </p>
      ) : null}
    </section>
  );
}
