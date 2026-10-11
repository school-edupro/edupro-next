'use client';

import { useMemo, useState } from 'react';

export interface WaiverLine {
  id: string;
  headId: string;
  headName: string;
  sequence: number;
  periodName: string;
  net: string;
  paid: string;
}

/**
 * Fee waiver by head and month: every unpaid fee line of the pupil is a box showing what is left;
 * type the amount to waive in the boxes you want (or fill a whole row or month), give one reason and
 * send. The boxes go as one request through the fee approval levels.
 */
export function WaiverGrid({
  studentId,
  lines,
  action,
  waiting = [],
}: {
  studentId: string;
  lines: WaiverLine[];
  action: (fd: FormData) => Promise<void>;
  /** Fee lines that already have a waiver waiting for approval: their boxes are closed. */
  waiting?: string[];
}) {
  const locked = new Set(waiting);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const left = (l: WaiverLine) => Math.max(Number(l.net) - Number(l.paid), 0);
  const open = useMemo(() => lines.filter((l) => left(l) > 0), [lines]);
  const months = [...new Map(open.map((l) => [l.sequence, l.periodName])).entries()].sort(
    (a, b) => a[0] - b[0],
  );
  const heads = [...new Map(open.map((l) => [l.headId, l.headName])).entries()];
  const cell = new Map(open.map((l) => [`${l.headId}:${l.sequence}`, l]));
  const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fill = (list: WaiverLine[], full: boolean) =>
    setAmounts((prev) => {
      const next = { ...prev };
      for (const l of list.filter((x) => !locked.has(x.id))) {
        if (full) next[l.id] = String(left(l));
        else delete next[l.id];
      }
      return next;
    });
  const picked = open.filter((l) => Number(amounts[l.id] ?? 0) > 0);
  const total = picked.reduce((a, l) => a + Number(amounts[l.id]), 0);
  const over = picked.filter((l) => Number(amounts[l.id]) > left(l) + 0.005);

  if (open.length === 0) return <p>Nothing is left to pay, so there is nothing to waive.</p>;
  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(
          picked.map((l) => ({ demandId: l.id, amount: Number(amounts[l.id]) })),
        )}
      />
      <p className="ep-field__help">
        Each box shows the fee still to pay. Type the amount to waive in a box, or use “Full” to
        waive a whole head or month. Leave a box empty to keep that fee.
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Amount to waive per fee head and month</caption>
          <thead>
            <tr>
              <th scope="col">Fee head</th>
              {months.map(([seq, name]) => {
                const col = open.filter((l) => l.sequence === seq);
                return (
                  <th key={seq} scope="col" style={{ textAlign: 'right' }}>
                    {name.split(' ')[0]!.slice(0, 3)}
                    <div>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Waive all of ${name}`}
                        onClick={() => fill(col, !col.every((l) => Number(amounts[l.id]) > 0))}
                      >
                        Full
                      </button>
                    </div>
                  </th>
                );
              })}
              <th scope="col">
                <span className="ep-sr-only">Whole head</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {heads.map(([headId, headName]) => {
              const row = open.filter((l) => l.headId === headId);
              return (
                <tr key={headId}>
                  <td>
                    <strong>{headName}</strong>
                  </td>
                  {months.map(([seq, name]) => {
                    const l = cell.get(`${headId}:${seq}`);
                    if (!l)
                      return (
                        <td key={seq} style={{ textAlign: 'right' }}>
                          —
                        </td>
                      );
                    const bad = Number(amounts[l.id] ?? 0) > left(l) + 0.005;
                    if (locked.has(l.id))
                      return (
                        <td key={seq} style={{ textAlign: 'right' }}>
                          <div className="ep-field__help">left {num(left(l))}</div>
                          <span className="ep-badge ep-badge--warning">waiver waiting</span>
                        </td>
                      );
                    return (
                      <td key={seq} style={{ textAlign: 'right' }}>
                        <div className="ep-field__help">left {num(left(l))}</div>
                        <input
                          className="ep-input"
                          type="number"
                          min={0}
                          max={left(l)}
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Waive from ${headName}, ${name} (left ${num(left(l))})`}
                          aria-invalid={bad || undefined}
                          value={amounts[l.id] ?? ''}
                          onChange={(e) => setAmounts((p) => ({ ...p, [l.id]: e.target.value }))}
                          style={{ minWidth: '5.5rem', textAlign: 'right' }}
                        />
                      </td>
                    );
                  })}
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Waive all of ${headName}`}
                      onClick={() => fill(row, !row.every((l) => Number(amounts[l.id]) > 0))}
                    >
                      Full
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'end',
          flexWrap: 'wrap',
          marginTop: 'var(--sp-3)',
        }}
      >
        <label className="ep-field" htmlFor="waiverReason" style={{ flex: '1 1 18rem', margin: 0 }}>
          <span className="ep-field__label">Reason *</span>
          <input
            className="ep-input"
            id="waiverReason"
            name="reason"
            required
            minLength={3}
            maxLength={300}
          />
        </label>
        <strong role="status">
          {picked.length} fee line{picked.length === 1 ? '' : 's'} · ₹{num(total)} to waive
        </strong>
        <button type="submit" className="ep-btn" disabled={picked.length === 0 || over.length > 0}>
          Send waiver for approval
        </button>
        <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setAmounts({})}>
          Clear
        </button>
      </div>
      {over.length > 0 ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {over.length} box{over.length === 1 ? ' is' : 'es are'} more than the fee left.
        </p>
      ) : null}
      <p className="ep-field__help">
        The whole request is approved or rejected together, by the levels set under Fee setup →
        Approval levels. The bill reduces only after the last approval. A bounce charge not yet paid
        is waived the same way: it is one of the rows.
      </p>
    </form>
  );
}
