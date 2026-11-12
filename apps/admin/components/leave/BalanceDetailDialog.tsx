'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BalanceDetail } from '@/lib/leave';
import { loadBalanceDetail } from '@/lib/leave-actions';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const wd = (d: string) => WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const n2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));
/** 10, 181.5 */
const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Leave Details (as the old Employee Leave Balance's): opened from a balance row's eye (`[data-lbd]` with
 * "employee|leave type|YYYY-MM") — the note of the month it is based on, the user, the policy, the month's
 * accrual worked out (or the period the next credit counts, so far), the attendance day by day with Is
 * Present / Is LOP / LOP %, and, folded, the row's figures and movements.
 */
export function BalanceDetailDialog() {
  const [key, setKey] = useState<string | null>(null);
  const [d, setD] = useState<BalanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-lbd]');
      if (!b?.dataset.lbd) return;
      e.preventDefault();
      setD(null);
      setError(null);
      setKey(b.dataset.lbd);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  useEffect(() => {
    if (!key) return;
    const el = ref.current;
    if (el && !el.open) el.showModal();
    const [emp = '', type = '', month = ''] = key.split('|');
    let live = true;
    void loadBalanceDetail(emp, type, month).then((r) => {
      if (!live) return;
      if (r.ok) setD(r.d);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [key]);
  if (!key) return null;
  const close = () => ref.current?.close();
  const a = d?.accrual;
  const kv = (rows: Array<[string, ReactNode]>) => (
    <table className="ep-lbd__kv">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="lg"
      aria-labelledby="lbd-title"
      onClose={() => setKey(null)}
    >
      <div className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="lbd-title" className="ep-card__title">
            Leave Details
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="ep-dialog__content ep-weekoff__content">
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>{error}</span>
            </p>
          ) : !d || !a ? (
            <p className="ep-field__help">Loading…</p>
          ) : (
            <>
              <p className="ep-note ep-lbd__note">
                <strong>Note:</strong> This report is based on {d.note}.
              </p>
              <section className="ep-lbd__sec" aria-labelledby="lbd-user">
                <h4 id="lbd-user" className="ep-lbd__head">
                  User Details
                </h4>
                {kv([
                  ['Employee', `${d.employee.name} (${d.employee.code})`],
                  ['Department', d.employee.department ?? '—'],
                  ['Designation', d.employee.designation ?? '—'],
                ])}
              </section>
              <section className="ep-lbd__sec" aria-labelledby="lbd-policy">
                <h4 id="lbd-policy" className="ep-lbd__head">
                  Policy Details
                </h4>
                {d.policy ? (
                  kv([
                    ['Policy', d.policy.name],
                    ['Leave Type', `${d.leaveType.code} — ${d.leaveType.name}`],
                    ['Annual Entitlement', `${num(d.policy.annualDays)} days`],
                    ['Accrual', d.policy.accrual],
                  ])
                ) : (
                  <p className="ep-lbd__warn">
                    No active policy gives {d.leaveType.code} to this employee, so nothing is
                    credited. Check Leave set-up → Policies.
                  </p>
                )}
              </section>
              <section className="ep-lbd__sec" aria-labelledby="lbd-accrual">
                <h4 id="lbd-accrual" className="ep-lbd__head">
                  Accrual — {a.words}
                  {a.kind === 'towards' && a.credit ? ' (so far)' : ''}
                </h4>
                {kv([
                  [
                    a.period ? 'Days In Period' : 'Days In Month',
                    a.daysShown < a.daysInPeriod
                      ? `${String(a.daysShown)} of ${String(a.daysInPeriod)} so far`
                      : String(a.daysInPeriod),
                  ],
                  [
                    'Present Days',
                    `${num(a.presentDays)}${a.daysShown < a.daysInPeriod ? ' so far' : ''}`,
                  ],
                  ['Accrued This Month', <strong key="v">{n2(a.accrued)}</strong>],
                ])}
                <p className="ep-lbd__small">
                  {[a.formula ? `${a.formula}.` : null, a.rule, a.remark].filter(Boolean).join(' ')}
                </p>
              </section>
              <section className="ep-lbd__sec" aria-labelledby="lbd-att">
                <h4 id="lbd-att" className="ep-lbd__head">
                  Employee Attendance
                </h4>
                {d.days.length ? (
                  <div
                    className="ep-table-wrap ep-lbd__days"
                    tabIndex={0}
                    role="region"
                    aria-label="Employee attendance, day by day"
                  >
                    <table className="ep-table ep-table--dense ep-lbd__att">
                      <thead>
                        <tr>
                          <th scope="col">Sr No.</th>
                          <th scope="col">Date</th>
                          <th scope="col">Attendance</th>
                          <th scope="col">Is Present</th>
                          <th scope="col">Is LOP</th>
                          <th scope="col">LOP %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.days.map((x, i) => (
                          <tr key={x.day}>
                            <td>{i + 1}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {dmy(x.day)}{' '}
                              <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                                {wd(x.day)}
                              </span>
                            </td>
                            <td>
                              <strong>{x.code}</strong> {x.words}
                            </td>
                            <td>{x.present}</td>
                            <td className={x.lop ? 'ep-lbd__lop' : undefined}>
                              {x.lop ? 'Yes' : 'No'}
                            </td>
                            <td>{x.lopPct === null ? '' : `${String(x.lopPct)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="ep-lbd__small">No attendance records for this month.</p>
                )}
              </section>
              <details className="ep-lbd__sec ep-lbd__more">
                <summary className="ep-lbd__head">
                  Balance and movements{' '}
                  <span className="ep-mr-col__desc" style={{ display: 'inline' }}>
                    — open bal, accrued, availed, correction, close bal, lapsed
                  </span>
                </summary>
                {kv([
                  [
                    'Period',
                    `${MONTHS[Number(d.month.slice(5, 7)) - 1]!} ${d.month.slice(0, 4)} · ${d.balance.closed ? 'Closed' : 'Open'}`,
                  ],
                  ['Opening / Accrued', `${n2(d.balance.opening)} / ${n2(d.balance.credited)}`],
                  ['Availed / Correction', `${n2(d.balance.held)} / ${n2(d.balance.correction)}`],
                  ['Closing / Lapsed', `${n2(d.balance.closing)} / ${n2(d.balance.lapsed)}`],
                  ['Available', <strong key="v">{n2(d.balance.available)}</strong>],
                ])}
                {d.balance.trail.length ? (
                  <ul className="ep-lbd__trail">
                    {d.balance.trail.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-lbd__small">Nothing moved in this month.</p>
                )}
              </details>
            </>
          )}
        </div>
        <div className="ep-dialog__actions ep-weekoff__actions">
          <button type="button" className="ep-btn ep-btn--primary ep-btn--sm" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
