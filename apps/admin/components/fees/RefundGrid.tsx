'use client';

import { useState } from 'react';

export interface RefundableLine {
  demandId: string;
  headId: string;
  head: string;
  sequence: number;
  period: string;
  paid: string;
}

/**
 * Refund of one receipt by fee head: every fee line the receipt paid is a box showing what it paid;
 * type the amount to give back (or "Full" for a head, a month or the whole receipt). The receipt's
 * advance and late fee can be given back too. One request goes for approval.
 */
export function RefundGrid({
  paymentId,
  studentId,
  lines,
  advance,
  lateFee,
  gateway,
  action,
  draftAction,
  draft,
}: {
  paymentId: string;
  studentId: string;
  lines: RefundableLine[];
  advance: string;
  lateFee: string;
  gateway: boolean;
  /** Sends the refund for approval at once. */
  action: (fd: FormData) => Promise<void>;
  /** Keeps it as a draft, to print the provisional refund bill first. */
  draftAction: (fd: FormData) => Promise<void>;
  /** The draft saved for this receipt: the form opens with it. */
  draft?: {
    lines: Array<{ part: string; demandId?: string; amount: string }>;
    feeAction: string;
    mode: string;
    reference: string | null;
    reason: string;
  } | null;
}) {
  const part = (k: string) => draft?.lines.find((l) => l.part === k)?.amount ?? '';
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (draft?.lines ?? [])
        .filter((l) => l.part === 'fee' && l.demandId)
        .map((l) => [l.demandId!, l.amount]),
    ),
  );
  const [adv, setAdv] = useState(part('advance'));
  const [late, setLate] = useState(part('late_fee'));
  const months = [...new Map(lines.map((l) => [l.sequence, l.period])).entries()].sort(
    (a, b) => a[0] - b[0],
  );
  const heads = [...new Map(lines.map((l) => [l.headId, l.head])).entries()];
  const cell = new Map(lines.map((l) => [`${l.headId}:${l.sequence}`, l]));
  const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fill = (list: RefundableLine[], full: boolean) =>
    setAmounts((prev) => {
      const next = { ...prev };
      for (const l of list) {
        if (full) next[l.demandId] = l.paid;
        else delete next[l.demandId];
      }
      return next;
    });
  const picked = lines.filter((l) => Number(amounts[l.demandId] ?? 0) > 0);
  const over =
    picked.some((l) => Number(amounts[l.demandId]) > Number(l.paid) + 0.005) ||
    Number(adv || 0) > Number(advance) + 0.005 ||
    Number(late || 0) > Number(lateFee) + 0.005;
  const total =
    picked.reduce((a, l) => a + Number(amounts[l.demandId]), 0) +
    Number(adv || 0) +
    Number(late || 0);
  const payload = [
    ...picked.map((l) => ({
      part: 'fee',
      demandId: l.demandId,
      amount: Number(amounts[l.demandId]),
    })),
    ...(Number(adv || 0) > 0 ? [{ part: 'advance', amount: Number(adv) }] : []),
    ...(Number(late || 0) > 0 ? [{ part: 'late_fee', amount: Number(late) }] : []),
  ];
  const allFull =
    lines.every((l) => Number(amounts[l.demandId]) > 0) &&
    (Number(advance) <= 0 || Number(adv) > 0) &&
    (Number(lateFee) <= 0 || Number(late) > 0);
  return (
    <form action={action}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <p className="ep-field__help">
        Each box shows what this receipt paid on that fee. Type the amount to give back, or press
        “Full”. Leave a box empty to keep that fee paid.
      </p>
      <p>
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          onClick={() => {
            fill(lines, !allFull);
            setAdv(!allFull && Number(advance) > 0 ? advance : '');
            setLate(!allFull && Number(lateFee) > 0 ? lateFee : '');
          }}
        >
          {allFull ? 'Clear all' : 'Refund the whole receipt'}
        </button>
      </p>
      {lines.length > 0 ? (
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Amount to refund per fee head and month</caption>
            <thead>
              <tr>
                <th scope="col">Fee head</th>
                {months.map(([seq, name]) => {
                  const col = lines.filter((l) => l.sequence === seq);
                  return (
                    <th key={seq} scope="col" style={{ textAlign: 'right' }}>
                      {name.split(' ')[0]!.slice(0, 3)}
                      <div>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Refund all of ${name}`}
                          onClick={() =>
                            fill(col, !col.every((l) => Number(amounts[l.demandId]) > 0))
                          }
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
              {heads.map(([headId, head]) => {
                const row = lines.filter((l) => l.headId === headId);
                return (
                  <tr key={headId}>
                    <td>
                      <strong>{head}</strong>
                    </td>
                    {months.map(([seq, name]) => {
                      const l = cell.get(`${headId}:${seq}`);
                      if (!l)
                        return (
                          <td key={seq} style={{ textAlign: 'right' }}>
                            —
                          </td>
                        );
                      const bad = Number(amounts[l.demandId] ?? 0) > Number(l.paid) + 0.005;
                      return (
                        <td key={seq} style={{ textAlign: 'right' }}>
                          <div className="ep-field__help">paid {num(Number(l.paid))}</div>
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            max={Number(l.paid)}
                            step="0.01"
                            inputMode="decimal"
                            aria-label={`Refund from ${head}, ${name} (paid ${num(Number(l.paid))})`}
                            aria-invalid={bad || undefined}
                            value={amounts[l.demandId] ?? ''}
                            onChange={(e) =>
                              setAmounts((p) => ({ ...p, [l.demandId]: e.target.value }))
                            }
                            style={{ minWidth: '5.5rem', textAlign: 'right' }}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Refund all of ${head}`}
                        onClick={() =>
                          fill(row, !row.every((l) => Number(amounts[l.demandId]) > 0))
                        }
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
      ) : (
        <p>This receipt paid no fee line (it is all advance or late fee).</p>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: 'var(--sp-3)',
          marginTop: 'var(--sp-4)',
          alignItems: 'start',
        }}
      >
        {Number(advance) > 0 ? (
          <label className="ep-field" htmlFor="rfAdvance">
            <span className="ep-field__label">Advance on the receipt (₹)</span>
            <input
              className="ep-input"
              id="rfAdvance"
              type="number"
              min={0}
              max={Number(advance)}
              step="0.01"
              value={adv}
              onChange={(e) => setAdv(e.target.value)}
            />
            <span className="ep-field__help">Up to {num(Number(advance))}.</span>
          </label>
        ) : null}
        {Number(lateFee) > 0 ? (
          <label className="ep-field" htmlFor="rfLate">
            <span className="ep-field__label">Late fee on the receipt (₹)</span>
            <input
              className="ep-input"
              id="rfLate"
              type="number"
              min={0}
              max={Number(lateFee)}
              step="0.01"
              value={late}
              onChange={(e) => setLate(e.target.value)}
            />
            <span className="ep-field__help">Up to {num(Number(lateFee))}.</span>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="rfAction">
          <span className="ep-field__label">The refunded fee *</span>
          <select
            className="ep-select"
            id="rfAction"
            name="feeAction"
            defaultValue={draft?.feeAction === 'cancel' ? 'cancel' : 'due'}
          >
            <option value="due">stays due (shows as outstanding again)</option>
            <option value="cancel">is cancelled (removed from the bill, not asked again)</option>
          </select>
          <span className="ep-field__help">
            Stays due: the money goes back and the fee is owed again (the usual case). Cancelled:
            only when the fee itself should go, such as transport stopped.
          </span>
        </label>
        <label className="ep-field" htmlFor="rfMode">
          <span className="ep-field__label">Pay back by *</span>
          <select
            className="ep-select"
            id="rfMode"
            name="mode"
            defaultValue={draft?.mode ?? 'bank'}
          >
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            {gateway ? <option value="gateway">The payment gateway (online)</option> : null}
          </select>
        </label>
        <label className="ep-field" htmlFor="rfRef">
          <span className="ep-field__label">Cheque no. / UTR</span>
          <input
            className="ep-input"
            id="rfRef"
            name="reference"
            maxLength={80}
            defaultValue={draft?.reference ?? ''}
          />
          <span className="ep-field__help">If already known; it prints on the voucher.</span>
        </label>
        <label className="ep-field" htmlFor="rfReason">
          <span className="ep-field__label">Reason *</span>
          <input
            className="ep-input"
            id="rfReason"
            name="reason"
            required
            minLength={3}
            maxLength={300}
            defaultValue={draft?.reason ?? ''}
          />
        </label>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 'var(--sp-3)',
        }}
      >
        <strong role="status">₹{num(total)} to refund</strong>
        <button
          type="submit"
          className="ep-btn"
          formAction={draftAction}
          disabled={total <= 0 || over}
        >
          Save as draft and print
        </button>
        <button type="submit" className="ep-btn ep-btn--secondary" disabled={total <= 0 || over}>
          Send for approval now
        </button>
      </div>
      <p className="ep-field__help">
        Save as draft: nothing is sent. You get the provisional refund bill to print for the parent;
        after that you send the draft for approval from that page, or change it here.
      </p>
      {over ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          An amount is more than what the receipt paid there.
        </p>
      ) : null}
    </form>
  );
}
