'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { closeExit, fnfAction, payFnf, saveFnf } from '@/lib/exit-actions';
import { dmy, type FnfLine, type FnfStatement } from '@/lib/exits';

const rs = (n: number) =>
  `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<FnfStatement['status'], string> = {
  draft: 'Draft (accounts)',
  submitted: 'Waiting for approval',
  approved: 'Approved: to be paid',
  paid: 'Settled',
};

/**
 * Employee exit, part 7: the full and final statement (accounts types the amounts; the clearance dues
 * come in by themselves), its approval and payment, the letters, and the close.
 */
export function ExitSettle({
  exitId,
  exitStatus,
  statement,
  close,
  handover,
  canClose,
}: {
  exitId: string;
  exitStatus: string;
  statement: FnfStatement | null;
  close: { leftOn: string; blockers: string[] };
  handover: Array<{ kind: string; what: string }> | null;
  canClose: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<FnfLine[]>(statement?.lines ?? []);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState('bank');
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [leftOn, setLeftOn] = useState(close.leftOn);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const done = (r: { ok: true } | { ok: false; error: string }, text: string) => {
    if (r.ok) {
      setMsg({ tone: 'success', text });
      router.refresh();
    } else setMsg({ tone: 'danger', text: r.error });
  };
  const edit = statement?.may.edit ?? false;
  const sum = (k: FnfLine['kind']) =>
    lines.filter((l) => l.kind === k).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const net = sum('earning') - sum('deduction');
  const setAmount = (code: string, v: string) =>
    setLines((cur) => cur.map((l) => (l.code === code ? { ...l, amount: Number(v) || 0 } : l)));
  const setNoteOf = (code: string, v: string) =>
    setLines((cur) => cur.map((l) => (l.code === code ? { ...l, note: v || null } : l)));

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <section
        className="ep-card"
        style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
      >
        <h2 className="ep-card__title" style={{ margin: 0 }}>
          Full and final statement
        </h2>
        {!statement ? (
          <p style={{ margin: 0 }}>Accounts prepares it once the exit is accepted.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              <span className="ep-badge ep-badge--info">{STATUS[statement.status]}</span>
              {statement.note ? ` · ${statement.note}` : ''}
              {statement.paidOn
                ? ` · ${statement.net >= 0 ? 'paid' : 'recovered'} ${dmy(statement.paidOn)} by ${statement.paidMode ?? ''}${statement.paidReference ? ` (${statement.paidReference})` : ''}`
                : ''}{' '}
              <ViewDownload href={`/api/exit-files/${exitId}/fnf`} what="the statement" />
            </p>
            {(['earning', 'deduction'] as const).map((k) => (
              <div key={k} className="ep-table-wrap" style={{ position: 'relative' }}>
                <table className="ep-table">
                  <caption className="ep-sr-only">
                    {k === 'earning' ? 'Earnings' : 'Deductions'}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{k === 'earning' ? 'Earnings' : 'Deductions'}</th>
                      <th scope="col">Amount (Rs.)</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .filter((l) => l.kind === k)
                      .map((l) => (
                        <tr key={l.code}>
                          <td>
                            {l.label}
                            {l.fromClearance ? (
                              <div className="ep-field__help">From the no-dues clearance</div>
                            ) : null}
                          </td>
                          <td>
                            {edit && !l.fromClearance ? (
                              <input
                                className="ep-input"
                                type="number"
                                min={0}
                                step="0.01"
                                aria-label={`${l.label}: amount`}
                                value={l.amount || ''}
                                placeholder="0"
                                onChange={(e) => setAmount(l.code, e.target.value)}
                              />
                            ) : (
                              rs(l.amount)
                            )}
                          </td>
                          <td>
                            {edit && !l.fromClearance ? (
                              <input
                                className="ep-input"
                                maxLength={200}
                                aria-label={`${l.label}: note`}
                                value={l.note ?? ''}
                                onChange={(e) => setNoteOf(l.code, e.target.value)}
                              />
                            ) : (
                              (l.note ?? '')
                            )}
                          </td>
                        </tr>
                      ))}
                    <tr>
                      <th scope="row">Total</th>
                      <td>
                        <strong>{rs(sum(k))}</strong>
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ margin: 0 }}>
              <strong>
                {net >= 0 ? 'Net payable to the employee' : 'Net recoverable from the employee'}:{' '}
                {rs(Math.abs(net))}
              </strong>
            </p>
            {statement.status === 'draft' && statement.clearancePending ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {statement.clearancePending} department(s) have not cleared: it is sent for approval
                once every department has.
              </p>
            ) : null}
            <div className="ep-form-actions">
              {edit ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  disabled={pending}
                  onClick={() => start(async () => done(await saveFnf(exitId, lines), 'Saved.'))}
                >
                  Save
                </button>
              ) : null}
              {statement.may.submit ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const s = await saveFnf(exitId, lines);
                      if (!s.ok) return setMsg({ tone: 'danger', text: s.error });
                      done(await fnfAction(exitId, 'submit'), 'Sent for approval.');
                    })
                  }
                >
                  Send for approval
                </button>
              ) : null}
            </div>
            {statement.may.decide ? (
              <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                <label className="ep-field" htmlFor="fnf-note">
                  <span className="ep-field__label">Remark (needed to send back)</span>
                  <input
                    id="fnf-note"
                    className="ep-input"
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <div className="ep-form-actions">
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending}
                    onClick={() =>
                      start(async () =>
                        done(
                          await fnfAction(exitId, 'approve', note.trim() || undefined),
                          'Approved.',
                        ),
                      )
                    }
                  >
                    Approve the statement
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary"
                    disabled={pending || note.trim().length < 3}
                    onClick={() =>
                      start(async () =>
                        done(
                          await fnfAction(exitId, 'return', note.trim()),
                          'Sent back to accounts.',
                        ),
                      )
                    }
                  >
                    Send back to accounts
                  </button>
                </div>
              </div>
            ) : null}
            {statement.may.pay ? (
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="fnf-on">
                  <span className="ep-field__label">
                    {statement.net >= 0 ? 'Paid on' : 'Recovered on'}
                  </span>
                  <input
                    id="fnf-on"
                    className="ep-input"
                    type="date"
                    value={paidOn}
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                </label>
                <label className="ep-field" htmlFor="fnf-mode">
                  <span className="ep-field__label">Mode</span>
                  <select
                    id="fnf-mode"
                    className="ep-select"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="bank">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                  </select>
                </label>
                <label className="ep-field" htmlFor="fnf-ref">
                  <span className="ep-field__label">Reference</span>
                  <input
                    id="fnf-ref"
                    className="ep-input"
                    maxLength={80}
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                </label>
                <div style={{ alignSelf: 'end' }}>
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending}
                    onClick={() =>
                      start(async () =>
                        done(
                          await payFnf(exitId, {
                            paidOn,
                            mode,
                            ...(ref.trim() ? { reference: ref.trim() } : {}),
                          }),
                          'Marked settled.',
                        ),
                      )
                    }
                  >
                    Mark {statement.net >= 0 ? 'paid' : 'recovered'}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section
        className="ep-card"
        style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
      >
        <h2 className="ep-card__title" style={{ margin: 0 }}>
          Letters
        </h2>
        <ul className="ep-rp__events" style={{ margin: 0 }}>
          <li>
            Acceptance{' '}
            {['approved', 'closed'].includes(exitStatus) ? (
              <ViewDownload
                href={`/api/exit-files/${exitId}/acceptance`}
                what="the acceptance letter"
              />
            ) : (
              <span className="ep-field__help">once the exit is accepted</span>
            )}
          </li>
          {(['relieving', 'experience'] as const).map((k) => (
            <li key={k}>
              {k === 'relieving' ? 'Relieving letter' : 'Experience certificate'}{' '}
              {exitStatus === 'closed' ? (
                <ViewDownload href={`/api/exit-files/${exitId}/${k}`} what={`the ${k} letter`} />
              ) : (
                <span className="ep-field__help">once the exit is closed</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        className="ep-card"
        style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-3)' }}
      >
        <h2 className="ep-card__title" style={{ margin: 0 }}>
          Close
        </h2>
        {exitStatus === 'closed' ? (
          <>
            <p style={{ margin: 0 }}>
              Closed: the employee is inactive, their sign-in and roles are stopped.
            </p>
            {handover?.length ? (
              <>
                <p style={{ margin: 0 }}>Ended on the leaving day, to re-assign:</p>
                <ul style={{ margin: 0 }}>
                  {handover.map((h) => (
                    <li key={`${h.kind}-${h.what}`}>
                      {h.kind}: {h.what}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                They held no class, subject or department to hand over.
              </p>
            )}
          </>
        ) : (
          <>
            {close.blockers.length ? (
              <ul style={{ margin: 0 }}>
                {close.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0 }}>Ready to close.</p>
            )}
            {canClose && exitStatus === 'approved' ? (
              <div className="ep-rp__row" style={{ alignItems: 'flex-end' }}>
                <label className="ep-field" htmlFor="ex-left">
                  <span className="ep-field__label">Leaving date</span>
                  <input
                    id="ex-left"
                    className="ep-input"
                    type="date"
                    value={leftOn}
                    onChange={(e) => setLeftOn(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="ep-btn ep-btn--danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => done(await closeExit(exitId, leftOn), 'Closed.'))
                  }
                >
                  Close the exit
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
