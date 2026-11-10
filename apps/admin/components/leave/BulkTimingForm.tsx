'use client';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@edupro/ui';
import { bulkTimings, type TimingBulkResult } from '@/lib/leave-actions';

type Key = 'startsAt' | 'endsAt' | 'grace' | 'presentHours' | 'halfDayHours' | 'note';
const LABEL: Record<Key, string> = {
  startsAt: 'Start time',
  endsAt: 'End time',
  grace: 'Grace minutes',
  presentHours: 'Present hours',
  halfDayHours: 'Half-day hours',
  note: 'Remark',
};
const DEFAULTS: Record<Key, string> = {
  startsAt: '09:00',
  endsAt: '17:00',
  grace: '5',
  presentHours: '8.00',
  halfDayHours: '4.50',
  note: '',
};
const HOURS = /^\d{1,2}(\.\d{1,2})?$/;

/**
 * Bulk Edit — Special Timing (the old module's tick-to-apply): pick who (the special timings of exactly
 * these dates, or every employee of a department), tick the fields to change, see what they hold now and
 * who changes or is made, then apply.
 */
export function BulkTimingForm({ departments }: { departments: string[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<'existing' | 'department'>('existing');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tick, setTick] = useState<Record<Key, boolean>>({
    startsAt: false,
    endsAt: false,
    grace: false,
    presentHours: false,
    halfDayHours: false,
    note: false,
  });
  const [val, setVal] = useState<Record<Key, string>>(DEFAULTS);
  const [check, setCheck] = useState<TimingBulkResult | null>(null);
  const [fail, setFail] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const close = () => router.push('/leave/setup/timings');

  const who = useMemo(() => {
    const e: Record<string, string> = {};
    if (scope === 'department' && !department) e.department = 'Pick the department.';
    if (!from) e.from = 'Pick the From date.';
    if (!to) e.to = 'Pick the To date.';
    else if (from && to < from) e.to = 'The To date is before the From date.';
    return e;
  }, [scope, department, from, to]);

  // what the people in scope hold now: shown, and put in the boxes not ticked yet
  useEffect(() => {
    setCheck(null);
    setFail('');
    if (Object.keys(who).length) return;
    let live = true;
    start(async () => {
      const r = await bulkTimings({
        scope,
        department: department || null,
        from,
        to,
        fields: {},
        dryRun: true,
      });
      if (!live) return;
      if (!r.ok) return setFail(r.error);
      setCheck(r.r);
      setVal((cur) => {
        const next = { ...cur };
        for (const k of Object.keys(LABEL) as Key[]) {
          const c = r.r.current[k];
          if (!tick[k] && c && !c.mixed && c.value !== null) next[k] = c.value;
        }
        return next;
      });
    });
    return () => {
      live = false;
    };
    // the boxes follow who is chosen, not the ticks
  }, [scope, department, from, to]);

  const errors = useMemo(() => {
    const e: Record<string, string> = { ...who };
    if (!Object.values(tick).some(Boolean)) e.fields = 'Tick at least one field to change.';
    if (tick.startsAt && !/^\d\d:\d\d$/.test(val.startsAt)) e.startsAt = 'Enter the start time.';
    if (tick.endsAt && !/^\d\d:\d\d$/.test(val.endsAt)) e.endsAt = 'Enter the end time.';
    if (tick.startsAt && tick.endsAt && !e.startsAt && !e.endsAt && val.endsAt <= val.startsAt)
      e.endsAt = 'The end time is after the start time.';
    if (tick.grace) {
      const n = Number(val.grace);
      if (val.grace.trim() === '' || !Number.isInteger(n) || n < 0 || n > 240)
        e.grace = 'A whole number from 0 to 240.';
    }
    for (const k of ['presentHours', 'halfDayHours'] as const)
      if (tick[k]) {
        const n = Number(val[k]);
        if (!HOURS.test(val[k].trim()) || n < 0 || n > 24)
          e[k] = 'Hours from 0 to 24, at most 2 decimals (7 h 30 m is 7.50).';
      }
    if (tick.presentHours && !e.presentHours && Number(val.presentHours) <= 0)
      e.presentHours = 'More than 0.';
    if (
      tick.presentHours &&
      tick.halfDayHours &&
      !e.presentHours &&
      !e.halfDayHours &&
      Number(val.halfDayHours) >= Number(val.presentHours)
    )
      e.halfDayHours = 'Half-day hours must be fewer than the present hours.';
    if (tick.note && val.note.length > 200) e.note = 'Up to 200 characters.';
    if (check && check.change + check.create === 0)
      e.nobody =
        scope === 'existing'
          ? 'Nobody has a special timing for exactly these dates here. Pick “Every employee in the department” to create them.'
          : 'This department has no active employees.';
    return e;
  }, [who, tick, val, check, scope]);

  const fields = () => {
    const out: Record<string, string | number | null> = {};
    for (const k of Object.keys(LABEL) as Key[])
      if (tick[k])
        out[k] =
          k === 'grace'
            ? Number(val[k])
            : k === 'presentHours' || k === 'halfDayHours'
              ? Number(val[k])
              : k === 'note'
                ? val.note.trim() || null
                : val[k];
    return out;
  };
  const apply = () => {
    setTried(true);
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0]!;
      document.getElementById(`bt-${first}`)?.focus();
      return;
    }
    start(async () => {
      const body = { scope, department: department || null, from, to, fields: fields() };
      // the check again with the ticks: a row the change would break stops it here
      const pre = await bulkTimings({ ...body, dryRun: true });
      if (!pre.ok) return setFail(pre.error);
      if (pre.r.problems.length) {
        setCheck(pre.r);
        return setFail(`Not applied — ${pre.r.problems.slice(0, 5).join(' · ')}`);
      }
      const r = await bulkTimings({ ...body, dryRun: false });
      if (!r.ok) return setFail(r.error);
      router.push(
        `/leave/setup/timings?ok=1&detail=${encodeURIComponent(
          `Bulk edit applied: ${String(r.r.change)} changed, ${String(r.r.create)} created. Days already worked out change when worked out again.`,
        )}`,
      );
    });
  };

  const show = (k: string) => tried && errors[k];
  const note = (k: string, help?: ReactNode) =>
    show(k) ? (
      <span className="ep-field__error" role="alert">
        {errors[k]}
      </span>
    ) : help ? (
      <span className="ep-field__help">{help}</span>
    ) : null;
  const now = (k: Key) => {
    const c = check?.current[k];
    if (!c) return null;
    if (c.mixed) return 'Now: mixed (people differ)';
    return c.value ? `Now: ${c.value}` : null;
  };
  const tickBox = (k: Key, type: string, step?: string) => (
    <div className="ep-field">
      <label className="ep-check" htmlFor={`bt-tick-${k}`}>
        <input
          id={`bt-tick-${k}`}
          type="checkbox"
          className="ep-check__box"
          checked={tick[k]}
          onChange={(e) => setTick((t) => ({ ...t, [k]: e.target.checked }))}
        />
        <span className="ep-check__text">{LABEL[k]}</span>
      </label>
      <input
        id={`bt-${k}`}
        className="ep-input"
        type={type}
        step={step}
        aria-label={`${LABEL[k]} (new value)`}
        disabled={!tick[k]}
        maxLength={k === 'note' ? 200 : undefined}
        placeholder={k === 'note' ? 'e.g. Winter timing for transport staff' : undefined}
        value={val[k]}
        aria-invalid={show(k) ? true : undefined}
        onChange={(e) => setVal((v) => ({ ...v, [k]: e.target.value }))}
      />
      {note(k, now(k))}
    </div>
  );

  const total = check ? check.change + check.create : 0;
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="xl"
      aria-labelledby="bt-title"
      onClose={close}
    >
      <div className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="bt-title" className="ep-card__title">
            Bulk Edit — Special Timing
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <div className="ep-dialog__content ep-weekoff__content">
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              Tick only the fields you want to change — everything left unticked keeps each
              employee’s own value. With “Every employee in the department”, employees with no
              timing for these dates get one created, using their current hours for whatever you did
              not tick.
            </span>
          </p>
          {fail ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>{fail}</span>
            </p>
          ) : null}
          {tried && Object.keys(errors).length ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>
                {errors.nobody ??
                  errors.fields ??
                  `${String(Object.keys(errors).length)} boxes need correcting: see the red notes below.`}
              </span>
            </p>
          ) : null}

          <h4 className="ep-kicker ep-weekoff__section">Who</h4>
          <div className="ep-shift__row">
            <div className="ep-field" style={{ gridColumn: 'span 2' }}>
              <label className="ep-field__label" htmlFor="bt-scope">
                Apply to<span aria-hidden="true"> *</span>
              </label>
              <select
                id="bt-scope"
                className="ep-select"
                value={scope}
                onChange={(e) => {
                  const s = e.target.value === 'department' ? 'department' : 'existing';
                  setScope(s);
                  if (s === 'department' && !department) setDepartment('');
                }}
              >
                <option value="existing">
                  Only employees who already have a timing for these dates
                </option>
                <option value="department">
                  Every employee in the department (missing ones are created)
                </option>
              </select>
              <span className="ep-field__help">
                The first option never creates a timing — it changes exactly what is already there.
              </span>
            </div>
            <div className="ep-field">
              <label className="ep-field__label" htmlFor="bt-department">
                Department{scope === 'department' ? <span aria-hidden="true"> *</span> : null}
              </label>
              <select
                id="bt-department"
                className="ep-select"
                value={department}
                aria-invalid={show('department') ? true : undefined}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">{scope === 'existing' ? 'All departments' : 'Choose…'}</option>
                {departments.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              {note(
                'department',
                from && to ? null : 'Enter the From and To dates to see what they already have.',
              )}
            </div>
          </div>
          <div className="ep-shift__row">
            <div className="ep-field">
              <label className="ep-field__label" htmlFor="bt-from">
                From date<span aria-hidden="true"> *</span>
              </label>
              <input
                id="bt-from"
                className="ep-input"
                type="date"
                value={from}
                aria-invalid={show('from') ? true : undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
              {note('from')}
            </div>
            <div className="ep-field">
              <label className="ep-field__label" htmlFor="bt-to">
                To date<span aria-hidden="true"> *</span>
              </label>
              <input
                id="bt-to"
                className="ep-input"
                type="date"
                value={to}
                min={from || undefined}
                aria-invalid={show('to') ? true : undefined}
                onChange={(e) => setTo(e.target.value)}
              />
              {note('to')}
            </div>
            <div className="ep-field" role="status">
              <span className="ep-field__label">Who changes</span>
              <span className="ep-field__help">
                {pending && !check
                  ? 'Checking…'
                  : check
                    ? `${String(check.change)} will change${scope === 'department' ? `, ${String(check.create)} will be created` : ''}.`
                    : 'Pick the dates (and the department) to see.'}
              </span>
              {check && total ? (
                <details>
                  <summary className="ep-field__help">Show the {total} employees</summary>
                  <ul className="ep-approvers">
                    {check.people.map((p) => (
                      <li key={p.name}>
                        {p.name}
                        {p.made ? <span className="ep-field__help"> · new</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </div>

          <h4 className="ep-kicker ep-weekoff__section" id="bt-fields" tabIndex={-1}>
            Fields to change
          </h4>
          <div className="ep-shift__row">
            {tickBox('startsAt', 'time')}
            {tickBox('endsAt', 'time')}
            {tickBox('grace', 'number', '1')}
          </div>
          <div className="ep-shift__row">
            {tickBox('presentHours', 'number', '0.25')}
            {tickBox('halfDayHours', 'number', '0.25')}
            <div />
          </div>
          {tickBox('note', 'text')}
        </div>
        <div className="ep-dialog__actions ep-weekoff__actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} loading={pending && tried}>
            ✓ Apply{check && total ? ` to ${String(total)}` : ''}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
