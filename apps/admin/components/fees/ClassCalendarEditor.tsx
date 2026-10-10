'use client';
import { useState } from 'react';
import { ClassCalendarGrid, type CalendarPeriod } from './ClassCalendarGrid';

export interface ClassRulesView {
  bounceCharge: string | null;
  schoolBounceCharge: string;
  classPayPlan: string | null;
  schoolPayPlan: string;
  classLateMode: 'slab' | 'daywise' | null;
  schoolLateMode: 'slab' | 'daywise';
  classLatePerDay: string | null;
  lateMax: string | null;
  schoolLatePerDay: string;
  periods: CalendarPeriod[];
}

const SLAB_COLUMNS = [
  'lateFee',
  'slabOn1',
  'slabAmt1',
  'slabOn2',
  'slabAmt2',
  'slabOn3',
  'slabAmt3',
  'bounce',
];

/**
 * The class calendar form: the late fee choice decides what is shown. Per day: the rate, the maximum
 * and the class's bounce charge, and a grid of dates only. Slabs: the grid with the slab dates and
 * amounts and the month's bounce charge. What is not shown is kept as saved.
 */
const PLAN: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

export function ClassCalendarEditor({
  rules,
  canManage,
}: {
  rules: ClassRulesView;
  canManage: boolean;
}) {
  const [mode, setMode] = useState<string>(rules.classLateMode ?? '');
  const perDay = (mode || rules.schoolLateMode) === 'daywise';
  return (
    <>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
          alignItems: 'start',
        }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Pay plan of this class</span>
          <select
            className="ep-select"
            name="payPlan"
            id="payPlan"
            defaultValue={rules.classPayPlan ?? ''}
            disabled={!canManage}
          >
            <option value="">As the school ({PLAN[rules.schoolPayPlan] ?? 'Monthly'})</option>
            <option value="monthly">Monthly (12 instalments)</option>
            <option value="quarterly">Quarterly (4 instalments)</option>
            <option value="half_yearly">Half-yearly (2 instalments)</option>
            <option value="yearly">Yearly (1 instalment)</option>
          </select>
          <span className="ep-field__help">
            The months of one instalment are due on the last date of its first month, and late fee
            is counted once, by that month’s row below.
          </span>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Late fee of this class</span>
          <select
            className="ep-select"
            name="lateMode"
            id="lateMode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={!canManage}
          >
            <option value="">
              As the school ({rules.schoolLateMode === 'slab' ? 'by slabs' : 'per day'})
            </option>
            <option value="daywise">Per day after the last date</option>
            <option value="slab">By slabs (dates and amounts)</option>
          </select>
        </label>
        <label className="ep-field" hidden={!perDay}>
          <span className="ep-field__label">Per day (₹)</span>
          <input
            className="ep-input"
            id="latePerDay"
            name="latePerDay"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rules.classLatePerDay ?? ''}
            disabled={!canManage}
          />
          <span className="ep-field__help">School: ₹{rules.schoolLatePerDay} a day</span>
        </label>
        <label className="ep-field" hidden={!perDay}>
          <span className="ep-field__label">Maximum per instalment (₹)</span>
          <input
            className="ep-input"
            id="lateMax"
            name="lateMax"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rules.lateMax ?? ''}
            disabled={!canManage}
          />
          <span className="ep-field__help">Empty = no limit.</span>
        </label>
        <label className="ep-field" hidden={!perDay}>
          <span className="ep-field__label">Bounce charge of the class (₹)</span>
          <input
            className="ep-input"
            id="bounceCharge"
            name="bounceCharge"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rules.bounceCharge ?? ''}
            disabled={!canManage}
          />
          <span className="ep-field__help">School: ₹{rules.schoolBounceCharge}</span>
        </label>
      </div>
      <p className="ep-field__help">
        {perDay
          ? 'Per day: the rate is charged for every day after the last date, up to the maximum. Fill only the dates below.'
          : 'Slabs: “Late fees” applies after the last date; after “Last date 1” the fee becomes “Late fee 1”, and so on (the later amount replaces the earlier one). Bounce is the cheque-bounce charge of that month.'}{' '}
        An empty box follows the school. Months with the same last date form one instalment. Show =
        No hides the instalment from parents; Fee pay = No lets them see it but not pay online.
        Unpaid bills move to a new last date as soon as you save.
      </p>
      <ClassCalendarGrid
        periods={rules.periods}
        canManage={canManage}
        hide={perDay ? SLAB_COLUMNS : []}
      />
    </>
  );
}
