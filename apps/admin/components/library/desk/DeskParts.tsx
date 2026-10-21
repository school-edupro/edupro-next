'use client';
import { useState, useTransition } from 'react';
import { deskBorrower, deskFindBorrower, deskSettleFine } from '@/lib/library-desk-actions';
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
export function BorrowerCard({ b }: { b: DeskBorrower }) {
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
            ...(b.finesDue ? [['Fines unpaid', rupees(b.finesDue)]] : []),
            ...(b.chargesDue ? [['Lost or damaged, unpaid', rupees(b.chargesDue)]] : []),
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
              · <a href="/library/fines">Fines</a>
            </>
          ) : null}
          {b.chargesDue ? (
            <>
              {' '}
              · <a href="/library/charges">Lost and damaged</a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** A returned book's late fine: collected now with the receipt reference, waived with a note, or later. */
export function FineSettle({
  loan,
  onDone,
}: {
  loan: LibraryLoan;
  onDone: (message: string) => void;
}) {
  const fine = Math.max(0, Number(loan.fineAmount) - Number(loan.fineWaived));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const settle = (action: 'collect' | 'waive') =>
    start(async () => {
      if (action === 'waive' && note.trim().length < 3) return setError('Say why it is waived');
      const r = await deskSettleFine(loan.id, {
        action,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (!r.ok) return setError(r.error);
      onDone(
        action === 'collect'
          ? `${rupees(fine)} collected for ${loan.accessionNo}`
          : `${rupees(fine)} waived for ${loan.accessionNo}`,
      );
    });
  if (!fine) return null;
  return (
    <div className="ep-alert ep-alert--warning" role="status" style={{ marginTop: 'var(--sp-3)' }}>
      <strong>
        Late fine {rupees(fine)} on {loan.accessionNo} ({loan.daysOverdue} days late)
      </strong>
      <div className="ep-desk__actions">
        <label className="ep-field" htmlFor={`fs-ref-${loan.id}`} style={{ margin: 0 }}>
          <span className="ep-field__label">Receipt reference</span>
          <input
            id={`fs-ref-${loan.id}`}
            className="ep-input"
            maxLength={60}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--primary ep-btn--sm"
          disabled={pending}
          onClick={() => settle('collect')}
        >
          Collect now
        </button>
        <label className="ep-field" htmlFor={`fs-note-${loan.id}`} style={{ margin: 0 }}>
          <span className="ep-field__label">Why waived</span>
          <input
            id={`fs-note-${loan.id}`}
            className="ep-input"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={pending}
          onClick={() => settle('waive')}
        >
          Waive
        </button>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => onDone(`${rupees(fine)} left on the Fines page for ${loan.accessionNo}`)}
        >
          Later
        </button>
      </div>
      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
