'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { clearExit, reopenClearance } from '@/lib/exit-actions';
import type { ClearanceRow } from '@/lib/exits';

const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/**
 * The no-dues clearance of an accepted exit (docs/design/38, part 6): each department clears it or
 * notes dues; what the system knows (library books, fines) is shown beside it. The office may open a
 * department's clearance again.
 */
export function ExitClearance({
  exitId,
  rows,
  canReopen,
}: {
  exitId: string;
  rows: ClearanceRow[];
  canReopen: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dues, setDues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const done = rows.filter((r) => r.status === 'cleared').length;
  const total = rows.reduce((s, r) => s + r.dues, 0);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        {done} of {rows.length} departments cleared
        {total > 0 ? ` · dues noted ${rs(total)} (recovered in the full and final statement)` : ''}.
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">No-dues clearance</caption>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">From the system</th>
              <th scope="col">Status</th>
              <th scope="col">Dues</th>
              <th scope="col">
                <span className="ep-sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.department}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="ep-field__help">Clears: {r.approvers.join(', ')}</div>
                </td>
                <td>
                  {r.check ? (
                    <span className={r.check.due ? 'ep-badge ep-badge--warning' : undefined}>
                      {r.check.detail}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {r.status === 'cleared' ? (
                    <>
                      <span className="ep-badge ep-badge--success">Cleared</span>
                      <div className="ep-field__help">
                        {r.actedBy ?? ''} {when(r.actedAt)}
                        {r.note ? ` · ${r.note}` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="ep-badge ep-badge--neutral">Waiting</span>
                  )}
                </td>
                <td>
                  {r.status === 'cleared' ? (
                    rs(r.dues)
                  ) : r.mayClear ? (
                    <div style={{ display: 'grid', gap: 'var(--sp-1)', minWidth: '12rem' }}>
                      <input
                        className="ep-input"
                        type="number"
                        min={0}
                        step="1"
                        aria-label={`${r.name}: dues in rupees`}
                        placeholder="Dues (Rs.), 0 if none"
                        value={dues[r.department] ?? ''}
                        onChange={(e) => setDues((d) => ({ ...d, [r.department]: e.target.value }))}
                      />
                      <input
                        className="ep-input"
                        maxLength={500}
                        aria-label={`${r.name}: note`}
                        placeholder="Note (what is owed, or why cleared)"
                        value={notes[r.department] ?? ''}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [r.department]: e.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {r.status === 'pending' && r.mayClear ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--primary ep-btn--sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const x = await clearExit(exitId, r.department, {
                            dues: Number(dues[r.department] || 0),
                            ...(notes[r.department]?.trim()
                              ? { note: notes[r.department]!.trim() }
                              : {}),
                          });
                          if (x.ok) {
                            setMsg({ tone: 'success', text: `${r.name} cleared.` });
                            router.refresh();
                          } else setMsg({ tone: 'danger', text: x.error });
                        })
                      }
                    >
                      Clear
                    </button>
                  ) : r.status === 'cleared' && canReopen ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const x = await reopenClearance(
                            exitId,
                            r.department,
                            'Opened by the office',
                          );
                          if (x.ok) router.refresh();
                          else setMsg({ tone: 'danger', text: x.error });
                        })
                      }
                    >
                      Open again
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
