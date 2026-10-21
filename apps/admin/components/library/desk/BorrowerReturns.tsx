'use client';
import { useState, useTransition } from 'react';
import { BorrowerCard, BorrowerPicker, FineSettle } from './DeskParts';
import { deskBorrower, deskRenew, deskReturnMany } from '@/lib/library-desk-actions';
import { dmy, fineOf, type DeskBorrower } from '@/lib/library-desk';
import type { LibraryLoan } from '@/lib/types';

/**
 * Return by borrower: every book a pupil or staff member holds, each returned or renewed, or all at
 * once; the fines of what came back late settled after.
 */
export function BorrowerReturns() {
  const [borrower, setBorrower] = useState<DeskBorrower | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [owed, setOwed] = useState<LibraryLoan[]>([]);
  const [pending, start] = useTransition();
  const refresh = async (b: DeskBorrower) => {
    const r = await deskBorrower(b.kind, b.id);
    if (r.ok) setBorrower(r.data);
  };
  const giveBack = (accessionNos: string[]) =>
    start(async () => {
      if (!borrower || !accessionNos.length) return;
      const r = await deskReturnMany(accessionNos);
      if (!r.ok) return setError(r.error);
      setError(null);
      setMessage(
        `${String(r.data.loans.length)} book${r.data.loans.length === 1 ? '' : 's'} returned by ${borrower.name}`,
      );
      setOwed((o) => [...o, ...r.data.loans.filter((l) => fineOf(l) > 0)]);
      await refresh(borrower);
    });
  const renew = (accessionNo: string) =>
    start(async () => {
      if (!borrower) return;
      const r = await deskRenew(accessionNo);
      if (!r.ok) return setError(r.error);
      setError(null);
      setMessage(`${r.data.accessionNo} renewed: due ${dmy(r.data.dueOn)}`);
      await refresh(borrower);
    });

  return (
    <div className="ep-desk__grid">
      <div>
        <section
          className="ep-card"
          aria-labelledby="ds-br-who"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="ds-br-who" className="ep-card__title">
            Borrower
          </h2>
          <BorrowerPicker
            id="ds-br-q"
            onPick={(b) => {
              setBorrower(b);
              setMessage(null);
              setError(null);
              setOwed([]);
            }}
          />
        </section>
        {borrower ? <BorrowerCard b={borrower} /> : null}
      </div>
      <section className="ep-card" aria-labelledby="ds-br-books">
        <h2 id="ds-br-books" className="ep-card__title">
          Books held{borrower ? ` · ${String(borrower.loans.length)}` : ''}
        </h2>
        {message ? (
          <p className="ep-alert ep-alert--success" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        {owed.map((l) => (
          <FineSettle
            key={l.id}
            loan={l}
            onDone={(m) => {
              setOwed((o) => o.filter((x) => x.id !== l.id));
              setMessage(m);
              if (borrower) void refresh(borrower);
            }}
          />
        ))}
        {!borrower ? (
          <p className="ep-field__help">Find the borrower first.</p>
        ) : borrower.loans.length === 0 ? (
          <p className="ep-field__help">No book is out with {borrower.name}.</p>
        ) : (
          <>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Books held">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Book</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Due</th>
                    <th scope="col">
                      <span className="ep-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {borrower.loans.map((l, i) => (
                    <tr key={l.id}>
                      <td>{i + 1}</td>
                      <td>
                        <strong>{l.title}</strong>
                        <div className="ep-field__help">
                          {l.accessionNo}
                          {l.author ? ` · ${l.author}` : ''}
                        </div>
                      </td>
                      <td>{dmy(l.issuedOn)}</td>
                      <td>
                        {dmy(l.dueOn)}
                        {l.daysOverdue > 0 ? (
                          <div>
                            <span className="ep-badge ep-badge--danger">
                              {l.daysOverdue} days late
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                          <button
                            type="button"
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            disabled={pending}
                            aria-label={`Return ${l.accessionNo}`}
                            onClick={() => giveBack([l.accessionNo])}
                          >
                            Return
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            disabled={pending}
                            aria-label={`Renew ${l.accessionNo}`}
                            onClick={() => renew(l.accessionNo)}
                          >
                            Renew
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ep-desk__actions">
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={() => giveBack(borrower.loans.map((l) => l.accessionNo))}
              >
                Return all ({borrower.loans.length})
              </button>
              <span className="ep-field__help">
                In good condition; a lost or damaged book: Lost and damaged books.
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
