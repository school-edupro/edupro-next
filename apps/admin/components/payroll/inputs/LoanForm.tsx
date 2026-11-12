'use client';
import { useState, useTransition } from 'react';
import type { ScheduleMonth, StaffOption } from '@/lib/payroll-inputs';
import { addLoan, previewLoan } from '@/lib/payroll-inputs-actions';

const inr = (v: string) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A new loan or advance, with its schedule shown before it is saved. */
export function LoanForm({ month, staff }: { month: string; staff: StaffOption[] }) {
  const [terms, setTerms] = useState({
    principal: '',
    emi: '',
    rate: '0',
    method: 'NONE',
    startMonth: month,
  });
  const [plan, setPlan] = useState<{
    months: ScheduleMonth[];
    count: number;
    totalInterest: string;
    lastMonth: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof terms) => (e: { currentTarget: { value: string } }) => {
    const v = e.currentTarget.value;
    setTerms((t) => ({ ...t, [k]: v }));
    setPlan(null);
  };
  const check = () =>
    start(async () => {
      const r = await previewLoan({
        ...terms,
        principal: terms.principal.replace(/,/g, ''),
        emi: terms.emi.replace(/,/g, ''),
        rate: terms.method === 'NONE' ? '0' : terms.rate,
      });
      setPlan(r.result);
      setError(r.error);
    });
  return (
    <form action={addLoan.bind(null, month)} className="ep-form-section__body">
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor="ln-emp">
          <span className="ep-field__label">Employee</span>
          <select id="ln-emp" name="employeeId" className="ep-select" required defaultValue="">
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
        <label className="ep-field" htmlFor="ln-type">
          <span className="ep-field__label">Kind</span>
          <input
            id="ln-type"
            name="loanType"
            className="ep-input"
            required
            maxLength={40}
            list="ln-types"
            defaultValue="ADVANCE"
          />
          <datalist id="ln-types">
            <option value="ADVANCE" />
            <option value="FESTIVAL" />
            <option value="LOAN" />
          </datalist>
        </label>
        <label className="ep-field" htmlFor="ln-amt">
          <span className="ep-field__label">Amount (₹)</span>
          <input
            id="ln-amt"
            name="principal"
            className="ep-input"
            required
            inputMode="decimal"
            value={terms.principal}
            onChange={set('principal')}
          />
        </label>
        <label className="ep-field" htmlFor="ln-emi">
          <span className="ep-field__label">Instalment a month (₹)</span>
          <input
            id="ln-emi"
            name="emi"
            className="ep-input"
            required
            inputMode="decimal"
            value={terms.emi}
            onChange={set('emi')}
          />
        </label>
        <label className="ep-field" htmlFor="ln-method">
          <span className="ep-field__label">Interest</span>
          <select
            id="ln-method"
            name="method"
            className="ep-select"
            value={terms.method}
            onChange={set('method')}
          >
            <option value="NONE">None</option>
            <option value="FLAT">Flat on the amount</option>
            <option value="REDUCING">On what is owed (reducing)</option>
          </select>
        </label>
        {terms.method !== 'NONE' ? (
          <label className="ep-field" htmlFor="ln-rate">
            <span className="ep-field__label">Rate (% a year)</span>
            <input
              id="ln-rate"
              name="rate"
              className="ep-input"
              required
              inputMode="decimal"
              value={terms.rate}
              onChange={set('rate')}
            />
          </label>
        ) : (
          <input type="hidden" name="rate" value="0" />
        )}
        <label className="ep-field" htmlFor="ln-start">
          <span className="ep-field__label">First instalment in</span>
          <input
            id="ln-start"
            name="startMonth"
            type="month"
            className="ep-input"
            required
            value={terms.startMonth}
            onChange={set('startMonth')}
          />
        </label>
      </div>
      <label className="ep-field" htmlFor="ln-why">
        <span className="ep-field__label">Remarks</span>
        <input id="ln-why" name="remarks" className="ep-input" maxLength={300} />
      </label>
      <p className="ep-grid__toolbar">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          onClick={check}
          disabled={pending || !terms.principal || !terms.emi}
        >
          {pending ? 'Working…' : 'Show the schedule'}
        </button>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={!plan}>
          Save the loan
        </button>
      </p>
      <div role="status" aria-live="polite">
        {error ? <p className="ep-field__error">{error}</p> : null}
        {plan ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {plan.count} instalment(s), the last in {plan.lastMonth}; interest in all ₹
            {inr(plan.totalInterest)}.
          </p>
        ) : null}
      </div>
      {plan ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="The schedule">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Owed</th>
                <th scope="col">Interest</th>
                <th scope="col">Instalment</th>
                <th scope="col">Left</th>
              </tr>
            </thead>
            <tbody>
              {plan.months.slice(0, 24).map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{inr(m.opening)}</td>
                  <td>{inr(m.interest)}</td>
                  <td>{inr(m.emi)}</td>
                  <td>{inr(m.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </form>
  );
}
