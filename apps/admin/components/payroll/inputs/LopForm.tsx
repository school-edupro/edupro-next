'use client';
import { useState, useTransition } from 'react';
import type { StaffOption } from '@/lib/payroll-inputs';
import { addLop, previewLop } from '@/lib/payroll-inputs-actions';

const inr = (v: string) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A loss-of-pay reversal: days of a locked month given back (+) or charged (−), valued before it is staged. */
export function LopForm({ month, staff }: { month: string; staff: StaffOption[] }) {
  const [v, setV] = useState({ employeeId: '', sourceMonth: '', days: '' });
  const [value, setValue] = useState<Awaited<ReturnType<typeof previewLop>>['result']>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: { currentTarget: { value: string } }) => {
    const x = e.currentTarget.value;
    setV((o) => ({ ...o, [k]: x }));
    setValue(null);
  };
  const check = () =>
    start(async () => {
      const r = await previewLop(v.employeeId, v.sourceMonth, v.days);
      setValue(r.result);
      setError(r.error);
    });
  return (
    <form action={addLop.bind(null, month)} className="ep-form-section__body">
      <p className="ep-field__help">
        For a month already locked: days given back (+) or charged (−) at that month’s own rates,
        paid as arrears with the next salary.
      </p>
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor="lr-emp">
          <span className="ep-field__label">Employee</span>
          <select
            id="lr-emp"
            name="employeeId"
            className="ep-select"
            required
            value={v.employeeId}
            onChange={set('employeeId')}
          >
            <option value="" disabled>
              Choose…
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="lr-month">
          <span className="ep-field__label">The month corrected</span>
          <input
            id="lr-month"
            name="sourceMonth"
            type="month"
            className="ep-input"
            required
            value={v.sourceMonth}
            onChange={set('sourceMonth')}
          />
        </label>
        <label className="ep-field" htmlFor="lr-days">
          <span className="ep-field__label">Days (+ back, − charged)</span>
          <input
            id="lr-days"
            name="days"
            className="ep-input"
            required
            inputMode="decimal"
            value={v.days}
            onChange={set('days')}
            placeholder="2 or -1.5"
          />
        </label>
      </div>
      <label className="ep-field" htmlFor="lr-why">
        <span className="ep-field__label">Reason</span>
        <input
          id="lr-why"
          name="reason"
          className="ep-input"
          required
          minLength={3}
          maxLength={200}
        />
      </label>
      <p className="ep-grid__toolbar">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={pending || !v.employeeId || !v.sourceMonth || !v.days}
          onClick={check}
        >
          {pending ? 'Working…' : 'Show the value'}
        </button>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={!value}>
          Stage it
        </button>
      </p>
      <div role="status" aria-live="polite">
        {error ? <p className="ep-field__error">{error}</p> : null}
        {value ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            A day: ₹{inr(value.perDay.pf)} with PF and ₹{inr(value.perDay.other)} without (that
            month had {value.monthDays} days and {value.lopDays} loss of pay). In all ₹
            {inr(value.total)}.
          </p>
        ) : null}
      </div>
    </form>
  );
}
