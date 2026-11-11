'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { CorrectionsLog } from '@/lib/leave';
import { loadCorrections } from '@/lib/leave-actions';

const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
/** dd-mm-yyyy hh:mm, India time */
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(/\//g, '-')
    .replace(',', '');
const shift = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/**
 * Attendance Corrections (as the old register's): the changes to the days of a month, newest first — the
 * employee, the day, what changed, the reason, who and when. ‹ › move a month; search by employee or by who
 * made the change; People only (ticked) hides what the system worked out itself.
 */
export function CorrectionLog({ month: start }: { month: string }) {
  const [month, setMonth] = useState(start);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState(true);
  const [page, setPage] = useState(1);
  const [d, setD] = useState<CorrectionsLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const load = useCallback(
    (m: string, p: number) =>
      start_(async () => {
        const r = await loadCorrections({ month: m, q, people, page: p });
        if (r.ok) {
          setD(r);
          setError(null);
        } else setError(r.error);
      }),
    [q, people],
  );
  // the first month once, on opening; Search and the arrows load after
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    load(start, 1);
  }, [load, start]);
  const go = (m: string, p = 1) => {
    setMonth(m);
    setPage(p);
    load(m, p);
  };
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  return (
    <div className="ep-bulk">
      <form
        className="ep-clog__bar"
        onSubmit={(e) => {
          e.preventDefault();
          go(month);
        }}
      >
        <div className="ep-clog__month">
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            aria-label="The month before"
            onClick={() => go(shift(month, -1))}
          >
            ‹
          </button>
          <label className="ep-sr-only" htmlFor="cl-month">
            Month
          </label>
          <input
            id="cl-month"
            type="month"
            className="ep-input"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            aria-label="The month after"
            onClick={() => go(shift(month, 1))}
          >
            ›
          </button>
        </div>
        <label className="ep-sr-only" htmlFor="cl-q">
          Search
        </label>
        <input
          id="cl-q"
          type="search"
          className="ep-input ep-clog__q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={80}
          placeholder="Employee ID, name or who made the change"
        />
        <label className="ep-check" htmlFor="cl-people">
          <input
            id="cl-people"
            type="checkbox"
            checked={people}
            onChange={(e) => setPeople(e.target.checked)}
          />
          <span>
            <strong>People only</strong>
            <span className="ep-mr-col__desc">
              Hide what the system worked out itself (punches, the nightly marks).
            </span>
          </span>
        </label>
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{error}</span>
        </p>
      ) : null}
      <p className="ep-listbar__count" aria-live="polite" style={{ textAlign: 'right' }}>
        {d
          ? `${d.monthWords}: ${d.total.toLocaleString('en-IN')} change${d.total === 1 ? '' : 's'}`
          : 'Loading…'}
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Attendance corrections">
        <table className="ep-table ep-clog">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Day</th>
              <th scope="col">What Changed</th>
              <th scope="col">Reason</th>
              <th scope="col">Changed By</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {d?.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong className="ep-clog__name">{r.employee.name}</strong>
                    <span className="ep-mr-col__desc">
                      {r.employee.code}
                      {r.employee.department ? ` · ${r.employee.department}` : ''}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <a href={`/leave/attendance/day?emp=${r.employee.id}&day=${r.day}`}>
                      {dmy(r.day)}
                    </a>
                  </td>
                  <td>
                    {r.changes.map((x) => (
                      <span key={x.what} className="ep-clog__change">
                        {x.what}
                        {x.from || x.to ? (
                          <>
                            {' '}
                            {x.from} <span aria-label="to">→</span> {x.to}
                          </>
                        ) : null}
                      </span>
                    ))}
                  </td>
                  <td>{r.reason ?? '—'}</td>
                  <td>
                    {r.by ? (
                      <>
                        <strong>{r.by.code || r.by.name}</strong>
                        {r.by.code ? <span className="ep-mr-col__desc">{r.by.name}</span> : null}
                      </>
                    ) : (
                      <span className="ep-mr-col__desc">The system</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  {d ? `No corrections in ${d.monthWords}${q ? ' for this search' : ''}.` : '…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav
          aria-label="Pages of corrections"
          className="ep-bulk__row"
          style={{ justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={page <= 1 || pending}
            onClick={() => go(month, page - 1)}
          >
            Previous
          </button>
          <span className="ep-field__help" style={{ margin: 0 }}>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={page >= pages || pending}
            onClick={() => go(month, page + 1)}
          >
            Next
          </button>
        </nav>
      ) : null}
      <p className="ep-field__help" style={{ margin: 0 }}>
        Corrections staff asked for, and where each waits:{' '}
        <a href={`/leave/attendance/exceptions?kind=regularisation&month=${month}`}>
          the correction requests
        </a>
        .
      </p>
    </div>
  );
}
