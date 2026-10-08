'use client';
import { useRef } from 'react';

export interface StructureRow {
  headId: string;
  code: string;
  name: string;
  optional: boolean;
  amounts: string[];
}

/**
 * Fee heads down, the twelve months across. The → on a head copies its first month to the whole year;
 * the ↓ on a month copies the first head's amount down that month.
 */
export function StructureGridTable({
  months,
  rows,
  monthTotals,
  total,
  canManage,
}: {
  months: Array<{ sequence: number; name: string; instalment: number }>;
  rows: StructureRow[];
  monthTotals: string[];
  total: string;
  canManage: boolean;
}) {
  const table = useRef<HTMLTableElement>(null);
  const fill = (selector: string) => {
    const cells = table.current?.querySelectorAll<HTMLInputElement>(selector);
    if (!cells || cells.length === 0) return;
    const first = cells[0]!.value;
    cells.forEach((c) => {
      c.value = first;
    });
  };
  const shown = (v: string) => (Number(v) === 0 ? '' : String(Number(v)));
  return (
    <div className="ep-table-wrap">
      <table className="ep-table ep-table--dense" ref={table}>
        <caption className="ep-sr-only">Fee per head and month</caption>
        <thead>
          <tr>
            <th scope="col">Fees head</th>
            {months.map((m) => (
              <th key={m.sequence} scope="col" style={{ textAlign: 'right' }}>
                {m.name.split(' ')[0]}
                <div className="ep-field__help">
                  Q{m.instalment}
                  {canManage ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() => fill(`[data-month="${m.sequence}"]`)}
                        aria-label={`Copy the first head's ${m.name} amount down the column`}
                        title="Copy the first head's amount down this month"
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.headId}>
              <th scope="row">
                <input type="hidden" name="headIds" value={r.headId} />
                {r.name}
                {r.optional ? <span className="ep-field__help"> (optional)</span> : null}
                {canManage ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => fill(`[data-head="${r.headId}"]`)}
                      aria-label={`Copy the first month of ${r.name} to every month`}
                      title="Copy the first month to every month"
                    >
                      →
                    </button>
                  </>
                ) : null}
              </th>
              {months.map((m, i) => (
                <td key={m.sequence}>
                  <input
                    className="ep-input"
                    type="number"
                    min={0}
                    step="0.01"
                    name={`a:${r.headId}:${m.sequence}`}
                    data-head={r.headId}
                    data-month={m.sequence}
                    defaultValue={shown(r.amounts[i] ?? '0')}
                    placeholder="0"
                    disabled={!canManage}
                    aria-label={`${r.name}: ${m.name}`}
                    style={{ minWidth: '6rem', textAlign: 'right' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Saved total: ₹{Number(total).toLocaleString('en-IN')}</th>
            {monthTotals.map((v, i) => (
              <th key={i} style={{ textAlign: 'right' }}>
                {Number(v).toLocaleString('en-IN')}
              </th>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
