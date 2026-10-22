'use client';
import { useRef, useState, useTransition } from 'react';
import { FineAtCounter } from './DeskParts';
import { deskBook, deskRenew, deskReturnOne } from '@/lib/library-desk-actions';
import { dmy, rupees, type DeskLookup } from '@/lib/library-desk';
import type { LibraryLoan } from '@/lib/types';

/**
 * Return: the book scanned shows its borrower, the dates and the late fine to today; returned in good
 * condition or damaged (no charge), the fine waived with its reason or sent to the fees counter as a misc
 * fee; renewed instead when the rule allows. With "Return as soon as scanned", a book with no fine goes
 * back on the scan.
 */
export function ReturnDesk() {
  const [no, setNo] = useState('');
  const [look, setLook] = useState<DeskLookup | null>(null);
  const [condition, setCondition] = useState<'available' | 'damaged'>('available');
  const [waive, setWaive] = useState(false);
  const [why, setWhy] = useState('');
  const [quick, setQuick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settle, setSettle] = useState<LibraryLoan | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const scan = useRef<HTMLInputElement>(null);
  const next = (message: string) => {
    setDone((d) => [message, ...d].slice(0, 12));
    setLook(null);
    setNo('');
    setCondition('available');
    setWaive(false);
    setWhy('');
    setTimeout(() => scan.current?.focus(), 0);
  };
  const giveBack = (l: DeskLookup) =>
    start(async () => {
      if (waive && why.trim().length < 3) return setError('Say why the fine is waived');
      const r = await deskReturnOne({
        accessionNo: l.book.accessionNo,
        condition,
        waiveFine: waive,
        waiveReason: waive ? why.trim() : undefined,
      });
      if (!r.ok) return setError(r.error);
      setError(null);
      const fine = Math.max(0, Number(r.data.fineAmount) - Number(r.data.fineWaived));
      const message = `${r.data.accessionNo} returned by ${r.data.borrower}${condition === 'damaged' ? ' (damaged)' : ''}${waive && Number(r.data.fineAmount) ? ` · fine ${rupees(Number(r.data.fineAmount))} waived` : ''}`;
      if (fine > 0) {
        setSettle(r.data);
        setDone((d) => [message, ...d].slice(0, 12));
        setLook(null);
        setNo('');
      } else next(message);
    });
  const find = () =>
    start(async () => {
      if (!no.trim()) return;
      setSettle(null);
      const r = await deskBook(no, 'return');
      if (!r.ok) {
        setLook(null);
        return setError(r.error);
      }
      setError(
        r.data.problem
          ? `${r.data.book.accessionNo}${r.data.book.formerly ? ` (scanned as ${r.data.book.formerly})` : ''}: ${r.data.problem}`
          : null,
      );
      setLook(r.data.problem ? null : r.data);
      if (!r.data.problem && quick && r.data.fine === 0) {
        const back = await deskReturnOne({
          accessionNo: r.data.book.accessionNo,
          condition: 'available',
        });
        if (!back.ok) return setError(back.error);
        next(`${back.data.accessionNo} returned by ${back.data.borrower}`);
      }
    });
  const renew = (l: DeskLookup) =>
    start(async () => {
      const r = await deskRenew(l.book.accessionNo);
      if (!r.ok) return setError(r.error);
      next(`${r.data.accessionNo} renewed for ${r.data.borrower}: due ${dmy(r.data.dueOn)}`);
    });
  const loan = look?.loan;

  return (
    <div className="ep-desk__grid">
      <section className="ep-card" aria-labelledby="ds-ret-h">
        <h2 id="ds-ret-h" className="ep-card__title">
          Return a book
        </h2>
        <form
          className="ep-desk__scan"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <label className="ep-field" htmlFor="ds-ret-no">
            <span className="ep-field__label">Book no. (scan or type, then Enter)</span>
            <input
              id="ds-ret-no"
              ref={scan}
              className="ep-input"
              value={no}
              maxLength={30}
              autoComplete="off"
              // the return desk starts here
              autoFocus
              onChange={(e) => setNo(e.target.value)}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
            {pending ? 'Looking…' : 'Find'}
          </button>
        </form>
        <label className="ep-check" htmlFor="ds-ret-quick" style={{ marginTop: 'var(--sp-2)' }}>
          <input
            id="ds-ret-quick"
            type="checkbox"
            checked={quick}
            onChange={(e) => setQuick(e.target.checked)}
          />{' '}
          Return as soon as scanned (a book with a late fine still stops for it)
        </label>
        {error ? (
          <p
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginTop: 'var(--sp-2)' }}
          >
            {error}
          </p>
        ) : null}
        {settle ? (
          <FineAtCounter
            loan={settle}
            onDone={(m) => {
              setSettle(null);
              next(m);
            }}
          />
        ) : null}
        {look && loan ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <dl className="ep-sheet__grid">
              {(
                [
                  ['Book', `${look.book.title}${look.book.author ? ` · ${look.book.author}` : ''}`],
                  [
                    'Book no.',
                    `${look.book.accessionNo}${look.book.formerly ? ` (scanned as ${look.book.formerly})` : ''}`,
                  ],
                  ['Subject', look.book.subject ?? '—'],
                  [
                    loan.borrowerKind === 'student' ? 'Pupil' : 'Staff',
                    `${loan.borrower} · ${loan.borrowerRef}`,
                  ],
                  [
                    loan.borrowerKind === 'student' ? 'Class · roll no.' : 'Designation',
                    `${loan.place ?? '—'}${loan.rollNo !== null ? ` · ${String(loan.rollNo)}` : ''}`,
                  ],
                  ['Issued on', dmy(loan.issuedOn)],
                  [
                    'Due on',
                    `${dmy(loan.dueOn)}${loan.daysOverdue ? ` · ${String(loan.daysOverdue)} days late` : ''}`,
                  ],
                  ['Late fine to today', look.fine ? rupees(look.fine) : 'None'],
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="ep-desk__actions">
              <label className="ep-field" htmlFor="ds-ret-cond" style={{ margin: 0 }}>
                <span className="ep-field__label">Condition</span>
                <select
                  id="ds-ret-cond"
                  className="ep-select"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as 'available' | 'damaged')}
                >
                  <option value="available">Good</option>
                  <option value="damaged">Damaged (no charge)</option>
                </select>
              </label>
              {look.fine ? (
                <label className="ep-check" htmlFor="ds-ret-waive">
                  <input
                    id="ds-ret-waive"
                    type="checkbox"
                    checked={waive}
                    onChange={(e) => setWaive(e.target.checked)}
                  />{' '}
                  Waive the fine
                </label>
              ) : null}
              {look.fine && waive ? (
                <label className="ep-field" htmlFor="ds-ret-why" style={{ margin: 0 }}>
                  <span className="ep-field__label">Why waived *</span>
                  <input
                    id="ds-ret-why"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={() => giveBack(look)}
              >
                Return
              </button>
              {loan.renewalsLeft > 0 ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  disabled={pending}
                  onClick={() => renew(look)}
                >
                  Renew ({loan.renewalsLeft} left)
                </button>
              ) : null}
              <a
                className="ep-btn ep-btn--ghost"
                href={`/library/charges?kind=lost&acc=${encodeURIComponent(look.book.accessionNo)}`}
              >
                Lost or damaged with a charge
              </a>
            </div>
          </div>
        ) : null}
      </section>
      <section className="ep-card" aria-labelledby="ds-ret-done">
        <h2 id="ds-ret-done" className="ep-card__title">
          Done at this desk
        </h2>
        {done.length ? (
          <ol style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {done.map((d, i) => (
              <li key={`${String(i)}-${d}`}>{d}</li>
            ))}
          </ol>
        ) : (
          <p className="ep-field__help">Returns and renewals of this visit show here.</p>
        )}
      </section>
    </div>
  );
}
