'use client';
import { useState, useTransition } from 'react';
import { deskBorrower, deskFindBorrower } from '@/lib/library-desk-actions';
import { rupees, type DeskBorrower, type DeskMatch } from '@/lib/library-desk';
import type { LibraryLoan } from '@/lib/types';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * Finds the borrower: an admission number or employee code opens them at once; a name lists the pupils
 * and staff to pick from.
 */
export function BorrowerPicker({
  id,
  onPick,
  autoFocus = true,
}: {
  id: string;
  onPick: (b: DeskBorrower | null) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<DeskMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const find = () =>
    start(async () => {
      if (q.trim().length < 2) return setError('Type an admission no., an employee code or a name');
      const r = await deskFindBorrower(q);
      if (!r.ok) return setError(r.error);
      setError(null);
      if (r.data.borrower) {
        setMatches(null);
        onPick(r.data.borrower);
      } else setMatches(r.data.matches);
    });
  const pick = (m: DeskMatch) =>
    start(async () => {
      const r = await deskBorrower(m.kind, m.id);
      if (!r.ok) return setError(r.error);
      setMatches(null);
      setQ(m.ref);
      onPick(r.data);
    });
  return (
    <div>
      <form
        className="ep-desk__scan"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <label className="ep-field" htmlFor={id}>
          <span className="ep-field__label">Admission no., employee code or name</span>
          <input
            id={id}
            className="ep-input"
            value={q}
            maxLength={80}
            autoComplete="off"
            // the desk starts here
            autoFocus={autoFocus}
            onChange={(e) => {
              setQ(e.target.value);
              if (!e.target.value) {
                setMatches(null);
                onPick(null);
              }
            }}
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
          {pending ? 'Finding…' : 'Find'}
        </button>
      </form>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ marginTop: 'var(--sp-2)' }}>
          {error}
        </p>
      ) : null}
      {matches ? (
        matches.length ? (
          <ul
            className="ep-desk__matches"
            aria-label="Borrowers found"
            style={{ marginTop: 'var(--sp-2)' }}
          >
            {matches.map((m) => (
              <li key={`${m.kind}-${m.id}`}>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => pick(m)}
                >
                  {m.name} · {m.ref}
                  {m.place ? ` · ${m.place}` : ''} · {m.kind === 'student' ? 'Pupil' : 'Staff'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">Nobody found.</p>
        )
      ) : null}
    </div>
  );
}

/** Who borrows: the photo, the numbers, the rule, what they hold and owe, what blocks an issue. */
export function BorrowerCard({ b, history = true }: { b: DeskBorrower; history?: boolean }) {
  const staff = b.kind === 'employee';
  return (
    <section className="ep-card" aria-label={`Borrower ${b.name}`}>
      <div className="ep-desk__who">
        {b.photoFileId ? (
          // photos pass through the admin's own origin
          <img src={`/api/files/${b.photoFileId}/view`} alt="" className="ep-desk__photo" />
        ) : (
          <span className="ep-desk__photo" aria-hidden="true">
            {initials(b.name)}
          </span>
        )}
        <div>
          <strong>
            <a href={staff ? `/people/employees/${b.id}` : `/people/students/${b.id}`}>{b.name}</a>
          </strong>
          <span className="ep-sl__sub">
            {staff ? 'Staff' : 'Pupil'} · {b.ref}
            {b.place ? ` · ${b.place}` : ''}
            {b.rollNo !== null ? ` · Roll no. ${String(b.rollNo)}` : ''}
          </span>
          {history ? (
            <a className="ep-desk__history" href={`/library/history/${b.kind}/${b.id}`}>
              Library history
            </a>
          ) : null}
        </div>
      </div>
      <dl className="ep-sheet__grid">
        {(
          [
            [
              'Rule',
              `${b.rule.label}: ${String(b.rule.maxBooks)} at a time, ${String(b.rule.loanDays)} days`,
            ],
            ['Holding', `${String(b.holding)} of ${String(b.rule.maxBooks)}`],
            ...(b.finesDue ? [['Old fines at the library', rupees(b.finesDue)]] : []),
            ...(b.chargesDue
              ? [['Due at the fees counter (late fines, lost or damaged)', rupees(b.chargesDue)]]
              : []),
          ] as Array<[string, string]>
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {b.blocked ? (
        <p
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginTop: 'var(--sp-3)' }}
        >
          {b.blocked}
          {b.finesDue ? (
            <>
              {' '}
              · <a href="/library/fines">Late fines</a>
            </>
          ) : null}
          {b.chargesDue ? (
            <>
              {b.finesDue ? null : (
                <>
                  {' '}
                  · <a href="/library/fines">Late fines</a>
                </>
              )}{' '}
              · <a href="/library/charges">Lost and damaged</a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A book back late: its fine is announced at once as a misc fee on the borrower and paid at the fees
 * counter (0217); the desk only says so.
 */
export function FineAtCounter({
  loan,
  onDone,
}: {
  loan: LibraryLoan;
  onDone: (message: string) => void;
}) {
  const fine = Math.max(0, Number(loan.fineAmount) - Number(loan.fineWaived));
  if (!fine) return null;
  return (
    <div className="ep-alert ep-alert--info" role="status" style={{ marginTop: 'var(--sp-3)' }}>
      <strong>
        Late fine {rupees(fine)} on {loan.accessionNo} ({loan.daysOverdue} days late)
      </strong>
      <p style={{ margin: 'var(--sp-1) 0 0' }}>
        It is announced as a misc fee on {loan.borrower}: paid at the fees counter, not here. To
        waive it now, ask the fees office from <a href="/library/fines">Late fines</a>.
      </p>
      <div className="ep-desk__actions">
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          onClick={() =>
            onDone(`${loan.accessionNo}: late fine ${rupees(fine)} sent to the fees counter`)
          }
        >
          OK
        </button>
      </div>
    </div>
  );
}
