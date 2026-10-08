'use client';
import { useRef } from 'react';

export interface CalendarPeriod {
  periodId: string;
  sequence: number;
  name: string;
  schoolDueOn: string;
  schoolLateFee: string;
  schoolInstalment: number;
  instalment: number | null;
  startOn: string | null;
  dueOn: string | null;
  lateFeeAmount: string | null;
  slabs: Array<{ on: string; amount: string }>;
  challanOn: string | null;
  bounceCharge: string | null;
  feePay: boolean;
  show: boolean;
}

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

type Col = { key: string; label: string; type: 'number' | 'date' | 'yesno'; step?: string };
const COLS: Col[] = [
  { key: 'instalment', label: 'Quarter', type: 'number', step: '1' },
  { key: 'startOn', label: 'Start fees date', type: 'date' },
  { key: 'dueOn', label: 'Last fees date', type: 'date' },
  { key: 'lateFee', label: 'Late fees', type: 'number' },
  { key: 'slabOn1', label: 'Last date 1', type: 'date' },
  { key: 'slabAmt1', label: 'Late fee 1', type: 'number' },
  { key: 'slabOn2', label: 'Last date 2', type: 'date' },
  { key: 'slabAmt2', label: 'Late fee 2', type: 'number' },
  { key: 'slabOn3', label: 'Last date 3', type: 'date' },
  { key: 'slabAmt3', label: 'Late fee 3', type: 'number' },
  { key: 'challanOn', label: 'Challan date', type: 'date' },
  { key: 'bounce', label: 'Bounce', type: 'number' },
  { key: 'feePay', label: 'Fee pay', type: 'yesno' },
  { key: 'show', label: 'Show', type: 'yesno' },
];

/**
 * The class-wise fee calendar: one row per month, as the accounts office keeps it. The ↓ in a column
 * head copies the first month's value down the column. An empty box follows the school.
 */
export function ClassCalendarGrid({
  periods,
  canManage,
}: {
  periods: CalendarPeriod[];
  canManage: boolean;
}) {
  const table = useRef<HTMLTableElement>(null);
  const copyDown = (key: string) => {
    const cells = table.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      `[data-col="${key}"]`,
    );
    if (!cells || cells.length === 0) return;
    const first = cells[0]!.value;
    cells.forEach((c) => {
      c.value = first;
    });
  };
  const value = (p: CalendarPeriod, key: string): string => {
    switch (key) {
      case 'instalment':
        return p.instalment === null ? '' : String(p.instalment);
      case 'startOn':
        return p.startOn ?? '';
      case 'dueOn':
        return p.dueOn ?? '';
      case 'lateFee':
        return p.lateFeeAmount ?? '';
      case 'challanOn':
        return p.challanOn ?? '';
      case 'bounce':
        return p.bounceCharge ?? '';
      case 'feePay':
        return p.feePay ? 'yes' : 'no';
      case 'show':
        return p.show ? 'yes' : 'no';
      default: {
        const n = Number(key.slice(-1)) - 1;
        const s = p.slabs[n];
        return key.startsWith('slabOn') ? (s?.on ?? '') : (s?.amount ?? '');
      }
    }
  };
  return (
    <div className="ep-table-wrap">
      <table className="ep-table ep-table--dense" ref={table}>
        <caption className="ep-sr-only">Class fee calendar, one row per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">School quarter · last date</th>
            {COLS.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
                {canManage ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => copyDown(c.key)}
                      aria-label={`Copy the first month's ${c.label} down the column`}
                      title="Copy the first month's value down the column"
                    >
                      ↓
                    </button>
                  </>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.periodId}>
              <th scope="row">
                <input type="hidden" name="periodIds" value={p.periodId} />
                {p.name}
              </th>
              <td>
                Q{p.schoolInstalment} · {dmy(p.schoolDueOn)}
              </td>
              {COLS.map((c) => (
                <td key={c.key}>
                  {c.type === 'yesno' ? (
                    <select
                      className="ep-select"
                      name={`${c.key}:${p.periodId}`}
                      data-col={c.key}
                      defaultValue={value(p, c.key)}
                      disabled={!canManage}
                      aria-label={`${p.name}: ${c.label}`}
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  ) : (
                    <input
                      className="ep-input"
                      type={c.type}
                      min={c.type === 'number' ? (c.key === 'instalment' ? 1 : 0) : undefined}
                      max={c.key === 'instalment' ? 12 : undefined}
                      step={c.type === 'number' ? (c.step ?? '0.01') : undefined}
                      name={`${c.key}:${p.periodId}`}
                      data-col={c.key}
                      defaultValue={value(p, c.key)}
                      disabled={!canManage}
                      aria-label={`${p.name}: ${c.label}`}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
