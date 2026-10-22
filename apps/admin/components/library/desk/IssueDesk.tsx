'use client';
import { useRef, useState, useTransition } from 'react';
import { BorrowerCard, BorrowerPicker } from './DeskParts';
import { deskBook, deskBorrower, deskIssue } from '@/lib/library-desk-actions';
import { dmy, type DeskBook, type DeskBorrower } from '@/lib/library-desk';
import type { LibraryLoan } from '@/lib/types';

/**
 * Issue: the borrower first, then the books scanned or typed one after another, each checked as it is
 * added (on the shelf, not reference only, within the limit); all issued together, with one due date
 * for the batch if one is set.
 */
export function IssueDesk({ today }: { today: string }) {
  const [borrower, setBorrower] = useState<DeskBorrower | null>(null);
  const [cart, setCart] = useState<DeskBook[]>([]);
  const [no, setNo] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<LibraryLoan[] | null>(null);
  const [pending, start] = useTransition();
  // a new borrower: the search box starts empty again
  const [round, setRound] = useState(0);
  const scan = useRef<HTMLInputElement>(null);
  const room = borrower ? borrower.rule.maxBooks - borrower.holding - cart.length : 0;
  const ruleDue = (() => {
    if (!borrower) return '';
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + borrower.rule.loanDays);
    return d.toISOString().slice(0, 10);
  })();

  const pick = (b: DeskBorrower | null) => {
    setBorrower(b);
    setCart([]);
    setIssued(null);
    setError(null);
    setDueOn('');
    if (b && !b.blocked) setTimeout(() => scan.current?.focus(), 0);
  };
  const add = () =>
    start(async () => {
      const typed = no.trim();
      if (!typed || !borrower) return;
      if (cart.some((c) => c.accessionNo.toUpperCase() === typed.toUpperCase()))
        return setError(`${typed} is already in the list`);
      if (room <= 0)
        return setError(
          `${borrower.name} may hold ${String(borrower.rule.maxBooks)} books (${borrower.rule.label})`,
        );
      const r = await deskBook(typed, 'issue', { kind: borrower.kind, id: borrower.id });
      if (!r.ok) return setError(r.error);
      if (r.data.problem)
        return setError(
          `${r.data.book.accessionNo}${r.data.book.formerly ? ` (scanned as ${r.data.book.formerly})` : ''}: ${r.data.problem}`,
        );
      if (cart.some((c) => c.copyId === r.data.book.copyId))
        return setError(`${r.data.book.accessionNo} is already in the list`);
      setCart((x) => [...x, r.data.book]);
      setNo('');
      setError(null);
      scan.current?.focus();
    });
  const issueAll = () =>
    start(async () => {
      if (!borrower || !cart.length) return;
      const r = await deskIssue({
        borrowerKind: borrower.kind,
        borrowerId: borrower.id,
        accessionNos: cart.map((c) => c.accessionNo),
        dueOn: dueOn || undefined,
      });
      if (!r.ok) return setError(r.error);
      setIssued(r.data.loans);
      setCart([]);
      setError(null);
      const again = await deskBorrower(borrower.kind, borrower.id);
      if (again.ok) setBorrower(again.data);
    });

  return (
    <div className="ep-desk__grid">
      <div>
        <section
          className="ep-card"
          aria-labelledby="ds-iss-who"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id="ds-iss-who" className="ep-card__title">
            Borrower
          </h2>
          <BorrowerPicker key={round} id="ds-iss-q" onPick={pick} />
        </section>
        {borrower ? <BorrowerCard b={borrower} /> : null}
      </div>
      <section className="ep-card" aria-labelledby="ds-iss-books">
        <h2 id="ds-iss-books" className="ep-card__title">
          Books
        </h2>
        {!borrower ? (
          <p className="ep-field__help">Find the borrower first.</p>
        ) : (
          <>
            <form
              className="ep-desk__scan"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label className="ep-field" htmlFor="ds-iss-no">
                <span className="ep-field__label">Book no. (scan or type, then Enter)</span>
                <input
                  id="ds-iss-no"
                  ref={scan}
                  className="ep-input"
                  value={no}
                  maxLength={30}
                  autoComplete="off"
                  disabled={Boolean(borrower.blocked)}
                  onChange={(e) => setNo(e.target.value)}
                />
              </label>
              <button
                type="submit"
                className="ep-btn ep-btn--secondary"
                disabled={pending || Boolean(borrower.blocked)}
              >
                Add
              </button>
            </form>
            {error ? (
              <p
                className="ep-alert ep-alert--danger"
                role="alert"
                style={{ marginTop: 'var(--sp-2)' }}
              >
                {error}
              </p>
            ) : null}
            {cart.length ? (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Books to issue"
                style={{ marginTop: 'var(--sp-3)' }}
              >
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Book no.</th>
                      <th scope="col">Title</th>
                      <th scope="col">Author</th>
                      <th scope="col">Subject</th>
                      <th scope="col">
                        <span className="ep-sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((c, i) => (
                      <tr key={c.copyId}>
                        <td>{i + 1}</td>
                        <td>
                          <strong>{c.accessionNo}</strong>
                          {c.formerly ? (
                            <div className="ep-field__help">scanned as {c.formerly}</div>
                          ) : null}
                        </td>
                        <td>{c.title}</td>
                        <td>{c.author ?? ''}</td>
                        <td>{c.subject ?? ''}</td>
                        <td>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Remove ${c.accessionNo}`}
                            onClick={() => setCart((x) => x.filter((y) => y.copyId !== c.copyId))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {cart.length ? (
              <div className="ep-desk__actions">
                <label className="ep-field" htmlFor="ds-iss-due" style={{ margin: 0 }}>
                  <span className="ep-field__label">Due on</span>
                  <input
                    id="ds-iss-due"
                    type="date"
                    className="ep-input"
                    min={today}
                    value={dueOn}
                    onChange={(e) => setDueOn(e.target.value)}
                  />
                  <span className="ep-field__help">
                    Empty: by the rule, {dmy(ruleDue)} ({borrower.rule.loanDays} days)
                  </span>
                </label>
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending}
                  onClick={issueAll}
                >
                  {pending ? 'Issuing…' : `Issue all (${String(cart.length)})`}
                </button>
                <span className="ep-field__help">
                  {room > 0 ? `${String(room)} more may be added` : 'The limit is reached'}
                </span>
              </div>
            ) : null}
            {issued ? (
              <div
                className="ep-alert ep-alert--success"
                role="status"
                style={{ marginTop: 'var(--sp-3)' }}
              >
                <strong>
                  Issued {issued.length} book{issued.length === 1 ? '' : 's'} to {borrower.name}
                </strong>
                <ul style={{ margin: 'var(--sp-2) 0 0' }}>
                  {issued.map((l) => (
                    <li key={l.id}>
                      {l.accessionNo} · {l.title} · due {dmy(l.dueOn)}
                    </li>
                  ))}
                </ul>
                <div className="ep-desk__actions">
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => {
                      pick(null);
                      setRound((n) => n + 1);
                    }}
                  >
                    Next borrower
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
