'use client';
import { useState, useTransition } from 'react';
import type { FormulaCheck, HeadVersion } from '@/lib/payroll';
import { checkFormula } from '@/lib/payroll-actions';

const CALC = [
  ['FIXED', 'Fixed: the amount on each employee’s structure'],
  ['FORMULA', 'Formula: worked out from other heads and rates'],
  ['SLAB', 'Slab: an amount or a per cent by a range of pay'],
  ['MANUAL', 'Manual: typed in each month'],
  ['SYSTEM', 'System: PF, ESI, PT, TDS … worked out by payroll'],
] as const;
const ROUND = [
  ['NEAREST_1', 'To the nearest rupee'],
  ['FLOOR_1', 'Down to the rupee'],
  ['CEIL_1', 'Up to the rupee'],
  ['NEAREST_10', 'To the nearest ₹10'],
  ['NEAREST_100', 'To the nearest ₹100'],
  ['CEIL_100', 'Up to the next ₹100'],
  ['NONE', 'Not rounded (paise kept)'],
] as const;

/**
 * The fields of a pay-head version (the head's add form and "New version"): how it is worked out, the formula
 * with a live check, slabs, the statutory wage flags, rounding, and the date it applies from.
 */
export function VersionFields({
  id,
  headType,
  last,
  lastSlabs = [],
}: {
  id: string;
  headType: 'EARNING' | 'DEDUCTION' | null;
  last?: HeadVersion | null;
  lastSlabs?: Array<{
    basis: string;
    rangeFrom: string;
    rangeTo: string | null;
    flatAmount: string | null;
    percent: string | null;
  }>;
}) {
  const [calc, setCalc] = useState<string>(last?.calcType ?? 'FIXED');
  const [type, setType] = useState<'EARNING' | 'DEDUCTION'>(headType ?? 'EARNING');
  const flag = (name: string, label: string, on: boolean) => (
    <label className="ep-check" htmlFor={`${id}-${name}`}>
      <input id={`${id}-${name}`} type="checkbox" name={name} defaultChecked={on} /> {label}
    </label>
  );
  return (
    <>
      {headType === null ? (
        <div className="ep-profile__grid">
          <label className="ep-field" htmlFor={`${id}-type`}>
            <span className="ep-field__label">Earning or deduction</span>
            <select
              id={`${id}-type`}
              name="headType"
              className="ep-select"
              value={type}
              onChange={(e) => setType(e.currentTarget.value as 'EARNING')}
            >
              <option value="EARNING">Earning</option>
              <option value="DEDUCTION">Deduction</option>
            </select>
          </label>
        </div>
      ) : null}
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor={`${id}-calc`}>
          <span className="ep-field__label">Worked out as</span>
          <select
            id={`${id}-calc`}
            name="calcType"
            className="ep-select"
            value={calc}
            onChange={(e) => setCalc(e.currentTarget.value)}
          >
            {CALC.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={`${id}-round`}>
          <span className="ep-field__label">Rounding</span>
          <select
            id={`${id}-round`}
            name="rounding"
            className="ep-select"
            defaultValue={last?.rounding ?? 'NEAREST_1'}
          >
            {ROUND.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={`${id}-from`}>
          <span className="ep-field__label">Applies from</span>
          <input id={`${id}-from`} name="effectiveFrom" type="date" className="ep-input" required />
          <span className="ep-field__help">
            The month it starts; the version in force ends the day before
          </span>
        </label>
      </div>
      {calc === 'FORMULA' ? (
        <FormulaBox id={id} pass={type === 'EARNING' ? 1 : 2} initial={last?.formula ?? ''} />
      ) : null}
      {calc === 'SLAB' ? (
        <div className="ep-profile__grid">
          <label className="ep-field" htmlFor={`${id}-basis`}>
            <span className="ep-field__label">Slabs by</span>
            <select
              id={`${id}-basis`}
              name="slabBasis"
              className="ep-select"
              defaultValue={lastSlabs[0]?.basis ?? 'BASIC'}
            >
              <option value="BASIC">Basic pay</option>
              <option value="BASIC_DA">Basic + DA</option>
              <option value="GROSS">Gross pay</option>
              <option value="PAY_LEVEL">Pay level</option>
            </select>
          </label>
          <label className="ep-field" htmlFor={`${id}-slabs`} style={{ gridColumn: '1 / -1' }}>
            <span className="ep-field__label">Slabs</span>
            <textarea
              id={`${id}-slabs`}
              name="slabs"
              className="ep-input"
              rows={4}
              required
              defaultValue={lastSlabs
                .map(
                  (s) =>
                    `${s.rangeFrom} | ${s.rangeTo ?? ''} | ${s.percent ? `${s.percent}%` : (s.flatAmount ?? '')}`,
                )
                .join('\n')}
              placeholder={'0 | 25000 | 1200\n25000.01 | | 8%'}
            />
            <span className="ep-field__help">
              One a line: from | up to (empty: and above) | an amount, or a per cent ending in %
            </span>
          </label>
        </div>
      ) : null}
      <label className="ep-field" htmlFor={`${id}-dep`}>
        <span className="ep-field__label">Depends on</span>
        <input
          id={`${id}-dep`}
          name="dependsOn"
          className="ep-input"
          maxLength={255}
          defaultValue={last?.dependsOn ?? ''}
          placeholder="BASIC,DA"
        />
        <span className="ep-field__help">
          The heads worked out before it (a formula’s own heads count already); the order is checked
          for loops
        </span>
      </label>
      <fieldset className="ep-field">
        <legend className="ep-field__label">It counts for</legend>
        <div className="ep-grid__toolbar">
          {flag('pfWage', 'PF wage', last?.pfWage ?? false)}
          {flag('esiWage', 'ESI wage', last?.esiWage ?? false)}
          {flag('ptWage', 'Profession-tax wage', last?.ptWage ?? true)}
          {flag('isTaxable', 'Income tax', last?.isTaxable ?? true)}
          {flag('prorateOnLop', 'Cut for loss of pay', last?.prorateOnLop ?? true)}
        </div>
      </fieldset>
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor={`${id}-ref`}>
          <span className="ep-field__label">Reference</span>
          <input id={`${id}-ref`} name="referenceNo" className="ep-input" maxLength={60} />
          <span className="ep-field__help">The order or circular number</span>
        </label>
        <label className="ep-field" htmlFor={`${id}-why`}>
          <span className="ep-field__label">Why</span>
          <input id={`${id}-why`} name="changeReason" className="ep-input" maxLength={200} />
        </label>
      </div>
    </>
  );
}

/** The formula, checked as typed: errors, the names it uses, unknown names and a value from sample inputs. */
export function FormulaBox({ id, pass, initial }: { id: string; pass: 1 | 2; initial: string }) {
  const [formula, setFormula] = useState(initial);
  const [inputs, setInputs] = useState('');
  const [res, setRes] = useState<FormulaCheck | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const vals: Record<string, string> = {};
      for (const line of inputs.split(/[\n,]/)) {
        const [k, v] = line.split('=').map((x) => x.trim());
        if (k && v) vals[k.toUpperCase()] = v;
      }
      setRes(await checkFormula(formula, pass, vals));
    });
  return (
    <div className="ep-profile__grid">
      <label className="ep-field" htmlFor={`${id}-formula`} style={{ gridColumn: '1 / -1' }}>
        <span className="ep-field__label">Formula</span>
        <input
          id={`${id}-formula`}
          name="formula"
          className="ep-input"
          required
          maxLength={255}
          value={formula}
          onChange={(e) => setFormula(e.currentTarget.value)}
          onBlur={run}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)' }}
          aria-describedby={`${id}-formula-help ${id}-formula-res`}
        />
        <span id={`${id}-formula-help`} className="ep-field__help">
          Heads in brackets ([BASIC]), rates by code (DA_RATE),{' '}
          {pass === 1
            ? 'PAID_DAYS, MONTH_DAYS, OT_HOURS'
            : 'PAID_DAYS, MONTH_DAYS, OT_HOURS, GROSS_EARNED, PF_WAGE, BASIC_DA'}
          ; + − × ÷ as + - * /, comparisons, ROUND, FLOOR, CEIL, MIN, MAX, IF(test, then, else).
        </span>
      </label>
      <label className="ep-field" htmlFor={`${id}-try`}>
        <span className="ep-field__label">Try it with</span>
        <input
          id={`${id}-try`}
          className="ep-input"
          value={inputs}
          onChange={(e) => setInputs(e.currentTarget.value)}
          placeholder="BASIC=56100, DA_RATE=0.55"
          spellCheck={false}
        />
      </label>
      <div className="ep-field">
        <span className="ep-field__label" aria-hidden="true">
          &nbsp;
        </span>
        <button
          type="button"
          className="ep-btn ep-btn--ghost"
          onClick={run}
          disabled={pending || !formula.trim()}
        >
          {pending ? 'Checking…' : 'Check the formula'}
        </button>
      </div>
      <div
        id={`${id}-formula-res`}
        role="status"
        aria-live="polite"
        style={{ gridColumn: '1 / -1' }}
      >
        {res ? (
          res.ok ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              <strong>It reads correctly.</strong>
              {res.headsUsed.length ? ` Heads: ${res.headsUsed.join(', ')}.` : ''}
              {res.varsUsed.length ? ` Rates and values: ${res.varsUsed.join(', ')}.` : ''}
              {res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}
              {res.result
                ? res.result.ok
                  ? ` With those values: ₹${res.result.value}.`
                  : ` With those values: ${res.result.errors.join('; ')}`
                : ''}
            </p>
          ) : (
            <p className="ep-field__error" style={{ margin: 0 }}>
              {res.errors.join('; ')}
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
