'use client';
import { useRef, useState } from 'react';

export interface HostelCalendarView {
  schoolPayPlan: string;
  mode: 'school' | 'own';
  payPlan: string | null;
  lateMode: 'slab' | 'daywise' | 'none';
  latePerDay: string | null;
  lateMax: string | null;
  hostellers: number;
  periods: Array<{
    periodId: string;
    sequence: number;
    name: string;
    schoolDueOn: string;
    dueOn: string | null;
    lateFeeAmount: string | null;
    latePerDay: string | null;
    startOn: string | null;
    challanOn: string | null;
    feePay: boolean;
    show: boolean;
    slabs: Array<{ on: string; amount: string }>;
  }>;
}

const PLAN: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};
const STEP: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const dmy = (v: string) => v.split('-').reverse().join('-');
const short = (name: string) => name.slice(0, 3);

type Col = {
  key: string;
  label: string;
  type: 'number' | 'date' | 'yesno';
  late?: 'slab' | 'daywise';
};
const COLS: Col[] = [
  { key: 'startOn', label: 'Start fees date', type: 'date' },
  { key: 'dueOn', label: 'Hostel last date', type: 'date' },
  { key: 'lateFee', label: 'Late fees', type: 'number', late: 'slab' },
  { key: 'slabOn1', label: 'Last date 1', type: 'date', late: 'slab' },
  { key: 'slabAmt1', label: 'Late fee 1', type: 'number', late: 'slab' },
  { key: 'slabOn2', label: 'Last date 2', type: 'date', late: 'slab' },
  { key: 'slabAmt2', label: 'Late fee 2', type: 'number', late: 'slab' },
  { key: 'slabOn3', label: 'Last date 3', type: 'date', late: 'slab' },
  { key: 'slabAmt3', label: 'Late fee 3', type: 'number', late: 'slab' },
  { key: 'perDay', label: 'Per day (₹)', type: 'number', late: 'daywise' },
  { key: 'challanOn', label: 'Challan date', type: 'date' },
  { key: 'feePay', label: 'Fee pay', type: 'yesno' },
  { key: 'show', label: 'Show', type: 'yesno' },
];

/** A date moved by whole months, the day kept (or the month's last day when it has fewer days). */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/**
 * The hostel calendar form, kept like the class calendar: the choice of calendar, plan and late fee
 * decides what is shown; what is not shown stays in the form, unseen, so nothing saved is lost. The ↓
 * in a column head copies the first month down: amounts as they are, dates a month later each row.
 */
export function HostelCalendarEditor({ cal, can }: { cal: HostelCalendarView; can: boolean }) {
  const [mode, setMode] = useState(cal.mode);
  const [plan, setPlan] = useState(cal.payPlan ?? '');
  const [late, setLate] = useState(cal.lateMode);
  const table = useRef<HTMLTableElement>(null);
  const own = mode === 'own';
  const step = STEP[plan || cal.schoolPayPlan] ?? 1;
  const hidden = (c: Col) => (c.late ? late !== c.late : false);

  const copyDown = (c: Col) => {
    const cells = table.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      `[data-col="${c.key}"]`,
    );
    if (!cells || cells.length === 0) return;
    const first = cells[0]!.value;
    cells.forEach((cell, i) => {
      cell.value = c.type === 'date' && first ? addMonths(first, i) : first;
    });
  };
  const value = (p: HostelCalendarView['periods'][number], key: string): string => {
    switch (key) {
      case 'startOn':
        return p.startOn ?? '';
      case 'dueOn':
        return p.dueOn ?? '';
      case 'lateFee':
        return p.lateFeeAmount ?? '';
      case 'perDay':
        return p.latePerDay ?? '';
      case 'challanOn':
        return p.challanOn ?? '';
      case 'feePay':
        return p.feePay ? 'yes' : 'no';
      case 'show':
        return p.show ? 'yes' : 'no';
      default: {
        const s = p.slabs[Number(key.slice(-1)) - 1];
        return key.startsWith('slabOn') ? (s?.on ?? '') : (s?.amount ?? '');
      }
    }
  };
  const groupOf = (seq: number) => Math.floor((seq - 1) / step);
  const byGroup = (g: number) => cal.periods.filter((x) => groupOf(x.sequence) === g);

  return (
    <>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Hostel calendar</legend>
        <label style={{ display: 'block' }}>
          <input
            type="radio"
            name="mode"
            value="school"
            checked={!own}
            onChange={() => setMode('school')}
            disabled={!can}
          />{' '}
          Same as school: hostel instalments use each class’s calendar (dates, late fee, Show, Fee
          pay)
        </label>
        <label style={{ display: 'block' }}>
          <input
            type="radio"
            name="mode"
            value="own"
            checked={own}
            onChange={() => setMode('own')}
            disabled={!can}
          />{' '}
          Own hostel calendar: the plan, dates and late fee below
        </label>
      </fieldset>

      {!own ? (
        <p className="ep-alert ep-alert--info" role="status" style={{ marginTop: 'var(--sp-3)' }}>
          Hostel fee falls due with school fee, on the dates and late fee of Fee setup → Class
          calendar, and is paid as each pupil’s pay plan. A pupil can still be given an own hostel
          plan through a fee change. Choose “Own hostel calendar” to set hostel dates here.
        </p>
      ) : null}

      <div hidden={!own}>
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
            alignItems: 'start',
            marginTop: 'var(--sp-3)',
          }}
        >
          <label className="ep-field" htmlFor="hostelPayPlan">
            <span className="ep-field__label">Hostel pay plan</span>
            <select
              className="ep-select"
              id="hostelPayPlan"
              name="payPlan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              disabled={!can}
            >
              <option value="">
                As each pupil’s school plan (school: {PLAN[cal.schoolPayPlan] ?? 'Monthly'})
              </option>
              <option value="monthly">Monthly (12 instalments)</option>
              <option value="quarterly">Quarterly (4 instalments)</option>
              <option value="half_yearly">Half-yearly (2 instalments)</option>
              <option value="yearly">Yearly (1 instalment)</option>
            </select>
            <span className="ep-field__help">
              The months of one instalment are due on the last date of its first month, and late fee
              is counted once, by that month’s row. A pupil can be given an own hostel plan through
              a fee change (approval).
            </span>
          </label>
          <label className="ep-field" htmlFor="hostelLateMode">
            <span className="ep-field__label">Hostel late fee</span>
            <select
              className="ep-select"
              id="hostelLateMode"
              name="lateMode"
              value={late}
              onChange={(e) => setLate(e.target.value as HostelCalendarView['lateMode'])}
              disabled={!can}
            >
              <option value="slab">By slabs (dates and amounts)</option>
              <option value="daywise">Per day after the last date</option>
              <option value="none">No late fee on hostel</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="hostelLatePerDay" hidden={late !== 'daywise'}>
            <span className="ep-field__label">Per day (₹)</span>
            <input
              className="ep-input"
              id="hostelLatePerDay"
              name="latePerDay"
              type="number"
              min={0}
              step="0.01"
              defaultValue={cal.latePerDay ?? ''}
              disabled={!can}
            />
            <span className="ep-field__help">A month’s own rate below replaces it.</span>
          </label>
          <label className="ep-field" htmlFor="hostelLateMax" hidden={late !== 'daywise'}>
            <span className="ep-field__label">Maximum per instalment (₹)</span>
            <input
              className="ep-input"
              id="hostelLateMax"
              name="lateMax"
              type="number"
              min={0}
              step="0.01"
              defaultValue={Number(cal.lateMax ?? 0) > 0 ? (cal.lateMax ?? '') : ''}
              disabled={!can}
            />
            <span className="ep-field__help">Empty or 0 = no limit.</span>
          </label>
        </div>
        <p className="ep-field__help">
          {late === 'daywise'
            ? 'Per day: the rate is charged for every day after the last date, up to the maximum.'
            : late === 'slab'
              ? '“Late fees” applies after the last date; after “Last date 1” the fee becomes “Late fee 1”, and so on (the later amount replaces the earlier one). Slab dates must be after the last date and in order.'
              : 'No late fee is charged on hostel fee.'}{' '}
          An empty last date takes the class calendar’s date of that month. Rows in grey are not the
          first month of their instalment: only a pupil on a monthly hostel plan uses them. Show =
          No hides the instalment from parents; Fee pay = No lets them see it but not pay online.
          Unpaid hostel bills move to a new last date as soon as you save.
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Hostel months">
          <table className="ep-table ep-table--dense" ref={table}>
            <caption className="ep-sr-only">Hostel fee calendar, one row per month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Instalment</th>
                <th scope="col">School date</th>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" hidden={hidden(c)}>
                    {c.label}
                    {can ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          onClick={() => copyDown(c)}
                          aria-label={`Copy the first month's ${c.label} down the column`}
                          title={
                            c.type === 'date'
                              ? 'Copy the first month’s date down, a month later each row'
                              : 'Copy the first month’s value down the column'
                          }
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
              {cal.periods.map((p) => {
                const months = byGroup(groupOf(p.sequence));
                const head = months[0]!;
                const lead = head.periodId === p.periodId;
                return (
                  <tr key={p.periodId} style={lead ? undefined : { color: 'var(--text-muted)' }}>
                    <th scope="row">
                      <input type="hidden" name="periodIds" value={p.periodId} />
                      {p.name}
                    </th>
                    <td>
                      {lead
                        ? months.length > 1
                          ? `${short(head.name)} – ${short(months[months.length - 1]!.name)}`
                          : short(head.name)
                        : `with ${short(head.name)}`}
                    </td>
                    <td>{dmy(p.schoolDueOn)}</td>
                    {COLS.map((c) => (
                      <td key={c.key} hidden={hidden(c)}>
                        {c.type === 'yesno' ? (
                          <select
                            className="ep-select"
                            name={`${c.key}:${p.periodId}`}
                            data-col={c.key}
                            defaultValue={value(p, c.key)}
                            disabled={!can}
                            aria-label={`${p.name}: ${c.label}`}
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        ) : (
                          <input
                            className="ep-input"
                            type={c.type}
                            min={c.type === 'number' ? 0 : undefined}
                            step={c.type === 'number' ? '0.01' : undefined}
                            name={`${c.key}:${p.periodId}`}
                            data-col={c.key}
                            defaultValue={value(p, c.key)}
                            disabled={!can}
                            aria-label={`${p.name}: ${c.label}`}
                            style={{ minWidth: c.type === 'date' ? '9.5rem' : '6rem' }}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
        {cal.hostellers} hosteller(s) this session. Late fee runs only on the hostel balance; part
        payments are taken.
      </p>
    </>
  );
}
