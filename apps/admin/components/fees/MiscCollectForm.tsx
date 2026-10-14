'use client';

import { useState } from 'react';

export interface MiscPayLine {
  id: string;
  title: string;
  head: string;
  mandatory: boolean;
  seats: number | null;
  seatsTaken: number;
  amount: string;
  paid: string;
  balance: string;
  lastDate: string;
  status: string;
  blocked: string | null;
}
const MODES: Array<[string, string]> = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['bank', 'Bank transfer'],
  ['cheque', 'Cheque'],
  ['dd', 'Demand draft'],
];
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');
const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Misc fees of a pupil received at the counter: tick the fees being paid, the amount of each (a fee
 * with seats is paid in full), then the payment mode with its cheque or reference details. One receipt
 * is made for each fee.
 */
export function MiscCollectForm({
  action,
  studentId,
  lines,
  today,
}: {
  action: (fd: FormData) => Promise<void>;
  studentId: string;
  lines: MiscPayLine[];
  today: string;
}) {
  const open = lines.filter((l) => l.status !== 'paid' && !l.blocked);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState('cash');
  const cheque = mode === 'cheque' || mode === 'dd';
  const total = open.reduce((a, l) => a + (Number(amounts[l.id]) || 0), 0);
  // a fee with seats takes a seat only when paid in full
  const short = open.some(
    (l) =>
      l.seats !== null &&
      !!amounts[l.id] &&
      Math.abs(Number(amounts[l.id]) - Number(l.balance)) > 0.005,
  );
  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Misc fees of the pupil">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Misc fees of the pupil</caption>
          <thead>
            <tr>
              <th scope="col">Fee</th>
              <th scope="col">Head</th>
              <th scope="col">Last date</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Paid
              </th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Balance
              </th>
              <th scope="col">Receive now</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const payable = l.status !== 'paid' && !l.blocked;
              return (
                <tr key={l.id}>
                  <td>
                    {l.title}
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {l.mandatory ? 'Mandatory' : 'Optional'}
                      {l.seats === null
                        ? ''
                        : ` · seats ${String(l.seatsTaken)} of ${String(l.seats)} taken`}
                    </span>
                  </td>
                  <td>{l.head}</td>
                  <td>{dmy(l.lastDate)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(l.amount)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(l.paid)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(l.balance)}</td>
                  <td>
                    {payable ? (
                      <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <input type="hidden" name="lineIds" value={l.id} />
                        <input
                          name={`amount:${l.id}`}
                          type="number"
                          min={0}
                          max={Number(l.balance)}
                          step="0.01"
                          className="ep-input"
                          style={{ maxWidth: '9rem' }}
                          aria-label={`Amount received on ${l.title}`}
                          value={amounts[l.id] ?? ''}
                          onChange={(e) => setAmounts({ ...amounts, [l.id]: e.target.value })}
                        />
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          onClick={() =>
                            setAmounts({
                              ...amounts,
                              [l.id]: amounts[l.id] ? '' : String(Number(l.balance)),
                            })
                          }
                        >
                          {amounts[l.id] ? 'Clear' : 'Full'}
                        </button>
                        {l.seats !== null &&
                        amounts[l.id] &&
                        Math.abs(Number(amounts[l.id]) - Number(l.balance)) > 0.005 ? (
                          <span className="ep-field__error" role="alert">
                            Limited seats: pay the full {rupees(l.balance)}
                          </span>
                        ) : null}
                      </span>
                    ) : l.status === 'paid' ? (
                      'Paid'
                    ) : (
                      l.blocked
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open.length === 0 ? (
        <p className="ep-field__help">Nothing can be received from this pupil now.</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              marginTop: 'var(--sp-4)',
            }}
          >
            <label className="ep-field" htmlFor="mc-mode" style={{ margin: 0 }}>
              <span className="ep-field__label">Payment mode</span>
              <select
                id="mc-mode"
                name="mode"
                className="ep-select"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                {MODES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="mc-on" style={{ margin: 0 }}>
              <span className="ep-field__label">Received on</span>
              <input
                id="mc-on"
                name="receivedOn"
                type="date"
                className="ep-input"
                defaultValue={today}
                max={today}
              />
            </label>
            {cheque ? (
              <>
                <label className="ep-field" htmlFor="mc-no" style={{ margin: 0 }}>
                  <span className="ep-field__label">Cheque / draft no. *</span>
                  <input
                    id="mc-no"
                    name="instrumentNo"
                    className="ep-input"
                    required
                    maxLength={40}
                  />
                </label>
                <label className="ep-field" htmlFor="mc-date" style={{ margin: 0 }}>
                  <span className="ep-field__label">Cheque date</span>
                  <input id="mc-date" name="instrumentDate" type="date" className="ep-input" />
                </label>
                <label className="ep-field" htmlFor="mc-bank" style={{ margin: 0 }}>
                  <span className="ep-field__label">Bank</span>
                  <input id="mc-bank" name="bankName" className="ep-input" maxLength={80} />
                </label>
              </>
            ) : mode !== 'cash' ? (
              <label className="ep-field" htmlFor="mc-ref" style={{ margin: 0 }}>
                <span className="ep-field__label">Reference / UTR</span>
                <input id="mc-ref" name="reference" className="ep-input" maxLength={80} />
              </label>
            ) : null}
            <label className="ep-field" htmlFor="mc-remarks" style={{ margin: 0 }}>
              <span className="ep-field__label">Remarks</span>
              <input id="mc-remarks" name="remarks" className="ep-input" maxLength={300} />
            </label>
          </div>
          <p style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
            <strong aria-live="polite">Total {rupees(total)}</strong>
            <button type="submit" className="ep-btn ep-btn--primary" disabled={total <= 0 || short}>
              Take the payment
            </button>
          </p>
        </>
      )}
    </form>
  );
}
