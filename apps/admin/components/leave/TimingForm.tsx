'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@edupro/ui';
import { ChipPicker, SearchPick } from '@/components/ChipPicker';
import { saveTimingDialog } from '@/lib/leave-actions';
import { SpecialTimingImport } from '@/components/leave/SpecialTimingImport';
import type { Timings } from '@/lib/leave';

type Row = Timings['rows'][number];
type Action = 'none' | 'HD' | 'A' | 'leave';
const ACTIONS: Array<{ value: Action; label: string }> = [
  { value: 'none', label: 'No rule' },
  { value: 'HD', label: 'Half day (half a day of leave charged)' },
  { value: 'A', label: 'Absent (a day of leave charged)' },
  { value: 'leave', label: 'Half day of a leave type I choose' },
];
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const HOURS = /^\d{1,2}(\.\d{1,2})?$/;
/** 6.25 → "6 h 15 m" */
const hours = (v: string | number) => {
  const n = typeof v === 'number' ? v : num(v);
  if (!Number.isFinite(n)) return '';
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${String(h)} h ${String(m)} m` : `${String(h)} h`;
};
const span = (a: string, b: string) => {
  if (!/^\d\d:\d\d$/.test(a) || !/^\d\d:\d\d$/.test(b)) return null;
  const [ah, am] = a.split(':').map(Number) as [number, number];
  const [bh, bm] = b.split(':').map(Number) as [number, number];
  return bh * 60 + bm - (ah * 60 + am);
};

/**
 * Add or edit a department timing (a department's own hours every day: one or several departments at
 * once) or a special timing (one employee's hours for some dates) in a dialog laid out like the old
 * module, every box checked as it is typed and again on save.
 */
export function TimingForm({
  kind,
  row,
  d,
  excel = false,
}: {
  kind: 'department' | 'special';
  row: Row | null;
  d: Timings;
  /** a new special timing: open on "Many from Excel" */
  excel?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const dept = kind === 'department';
  // a new special timing: one employee here, or many at once from Excel
  const tabs = !dept && !row;
  const [mode, setMode] = useState<'one' | 'excel'>(tabs && excel ? 'excel' : 'one');
  const [v, setV] = useState({
    departments: row?.department ? [row.department] : ([] as string[]),
    employeeId: row?.employee_id ?? '',
    from: row?.from_date ?? '',
    to: row?.to_date ?? '',
    startsAt: (row?.starts_at ?? '09:00').slice(0, 5),
    endsAt: (row?.ends_at ?? '17:00').slice(0, 5),
    grace: String(row?.grace_minutes ?? 5),
    presentHours: row ? String(row.present_hours) : '8.00',
    halfDayHours: row ? String(row.half_day_hours) : '4.50',
    lateOver: row?.late_over_minutes ? String(row.late_over_minutes) : '0',
    lateAction: (row?.late_action as Action) || 'none',
    lateTypeId: row?.late_type_id ?? '',
    earlyOver: row?.early_over_minutes ? String(row.early_over_minutes) : '0',
    earlyAction: (row?.early_action as Action) || 'none',
    earlyTypeId: row?.early_type_id ?? '',
    note: row?.note ?? '',
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  type K = keyof typeof v;
  const set = (k: K, value: string | string[]) => setV((cur) => ({ ...cur, [k]: value }));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const close = () => router.push('/leave/setup/timings');

  // departments that already have a timing (one each): not offered again when adding
  const taken = new Set(
    d.rows
      .filter((r) => r.kind === 'department' && r.id !== row?.id)
      .map((r) => (r.department ?? '').toLowerCase()),
  );

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (dept) {
      if (!v.departments.length) e.departments = 'Pick at least one department.';
      const dup = v.departments.filter((x) => taken.has(x.toLowerCase()));
      if (dup.length)
        e.departments = `${dup.join(', ')} already ${dup.length === 1 ? 'has' : 'have'} a timing: edit it in the list instead.`;
    } else {
      if (!v.employeeId) e.employeeId = 'Pick the employee.';
      if (!v.from) e.from = 'Pick the first date.';
      if (!v.to) e.to = 'Pick the last date.';
      else if (v.from && v.to < v.from) e.to = 'The last date is before the first.';
    }
    if (!/^\d\d:\d\d$/.test(v.startsAt)) e.startsAt = 'Enter the start time.';
    if (!/^\d\d:\d\d$/.test(v.endsAt)) e.endsAt = 'Enter the end time.';
    else if (v.endsAt <= v.startsAt) e.endsAt = 'The end time is after the start time.';
    const g = num(v.grace);
    if (!Number.isInteger(g) || g < 0 || g > 240) e.grace = 'Grace: a whole number from 0 to 240.';
    const hrs = (k: 'presentHours' | 'halfDayHours', label: string) => {
      const n = num(v[k]);
      if (!Number.isFinite(n)) e[k] = `Enter the ${label.toLowerCase()}.`;
      else if (n < 0 || n > 24) e[k] = `${label}: from 0 to 24.`;
      else if (!HOURS.test(v[k].trim())) e[k] = `${label}: at most 2 decimals (7 h 30 m is 7.50).`;
    };
    hrs('presentHours', 'Present hours');
    hrs('halfDayHours', 'Half-day hours');
    if (!e.presentHours && num(v.presentHours) <= 0) e.presentHours = 'Present hours: more than 0.';
    if (!e.presentHours && !e.halfDayHours && num(v.halfDayHours) >= num(v.presentHours))
      e.halfDayHours = 'Half-day hours must be fewer than the present hours.';
    const win = span(v.startsAt, v.endsAt);
    if (!e.presentHours && !e.endsAt && win && num(v.presentHours) * 60 > win)
      e.presentHours = `Present hours are longer than the working times (${hours(win / 60)}).`;
    const rule = (side: 'late' | 'early', label: string) => {
      const mk = `${side}Over` as const;
      const ak = `${side}Action` as const;
      const tk = `${side}TypeId` as const;
      const raw = v[mk].trim();
      const n = raw === '' ? 0 : num(raw);
      if (!Number.isInteger(n) || n < 0 || n > 720)
        e[mk] = `${label}: a whole number from 0 to 720 (0 = off).`;
      else if (n > 0 && v[ak] === 'none')
        e[ak] = 'Choose what the day becomes, or set the minutes to 0.';
      else if (n === 0 && v[ak] !== 'none')
        e[mk] = 'Give the minutes after which the rule applies.';
      if (v[ak] === 'leave' && !v[tk]) e[tk] = 'Choose the leave type to charge.';
    };
    rule('late', 'Late by more than');
    rule('early', 'Left early by more than');
    if (v.note.length > 200) e.note = 'Up to 200 characters.';
    return e;
  }, [v, dept]);

  const show = (k: string) => (tried || touched[k]) && errors[k];
  const field = (
    k: string,
    label: ReactNode,
    input: ReactNode,
    help?: ReactNode,
    req?: boolean,
  ) => (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor={`tf-${k}`}>
        {label}
        {req ? <span aria-hidden="true"> *</span> : null}
      </label>
      {input}
      {show(k) ? (
        <span className="ep-field__error" id={`tf-${k}-err`} role="alert">
          {errors[k]}
        </span>
      ) : help ? (
        <span className="ep-field__help">{help}</span>
      ) : null}
    </div>
  );
  const box = (
    k: Exclude<K, 'departments'>,
    o: { type?: string; step?: string; mode?: 'numeric' | 'decimal'; placeholder?: string } = {},
  ) => (
    <input
      id={`tf-${k}`}
      className="ep-input"
      type={o.type ?? 'text'}
      step={o.step}
      inputMode={o.mode}
      placeholder={o.placeholder}
      maxLength={k === 'note' ? 200 : undefined}
      value={v[k]}
      aria-invalid={show(k) ? true : undefined}
      aria-describedby={show(k) ? `tf-${k}-err` : undefined}
      onChange={(e) => set(k, e.target.value)}
      onBlur={() => touch(k)}
    />
  );
  const select = (
    k: Exclude<K, 'departments'>,
    options: Array<{ value: string; label: string }>,
  ) => (
    <select
      id={`tf-${k}`}
      className="ep-select"
      value={v[k]}
      aria-invalid={show(k) ? true : undefined}
      aria-describedby={show(k) ? `tf-${k}-err` : undefined}
      onChange={(e) => set(k, e.target.value)}
      onBlur={() => touch(k)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    setTried(true);
    const keys = Object.keys(errors);
    if (keys.length) {
      e.preventDefault();
      const first = document.getElementById(`tf-${keys[0]!}`);
      first?.focus();
    }
  };

  const present = hours(v.presentHours);
  const half = hours(v.halfDayHours);
  const win = span(v.startsAt, v.endsAt);
  const count = Object.keys(errors).length;
  const late = num(v.lateOver) > 0;
  const early = num(v.earlyOver) > 0;
  const ruleRow = (side: 'late' | 'early') => {
    const mk = `${side}Over` as const;
    const ak = `${side}Action` as const;
    const tk = `${side}TypeId` as const;
    return (
      <div className="ep-shift__row">
        {field(
          mk,
          side === 'late' ? 'Late by more than (minutes)' : 'Left early by more than (minutes)',
          box(mk, { type: 'number', step: '1', mode: 'numeric' }),
          '0 = off',
        )}
        {field(ak, 'then mark the day', select(ak, ACTIONS))}
        {v[ak] === 'leave' ? (
          field(
            tk,
            'Leave type charged',
            select(tk, [
              { value: '', label: 'Choose…' },
              ...d.types.map((t) => ({ value: t.id, label: t.name })),
            ]),
            undefined,
            true,
          )
        ) : (
          <div />
        )}
      </div>
    );
  };

  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="xl"
      aria-labelledby="tf-title"
      onClose={close}
    >
      <form action={saveTimingDialog} onSubmit={submit} noValidate className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="tf-title" className="ep-card__title">
            {row ? 'Edit' : 'Add'} {dept ? 'Department Timing' : 'Special Timing'}
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        <input type="hidden" name="kind" value={kind} />
        {dept ? (
          v.departments.map((x) => <input key={x} type="hidden" name="department" value={x} />)
        ) : (
          <>
            <input type="hidden" name="employeeId" value={v.employeeId} />
            <input type="hidden" name="from" value={v.from} />
            <input type="hidden" name="to" value={v.to} />
          </>
        )}
        <input type="hidden" name="startsAt" value={v.startsAt} />
        <input type="hidden" name="endsAt" value={v.endsAt} />
        <input type="hidden" name="grace" value={v.grace} />
        <input type="hidden" name="presentHours" value={v.presentHours} />
        <input type="hidden" name="halfDayHours" value={v.halfDayHours} />
        <input type="hidden" name="lateOver" value={late ? v.lateOver : ''} />
        <input type="hidden" name="lateAction" value={late ? v.lateAction : 'none'} />
        <input
          type="hidden"
          name="lateTypeId"
          value={late && v.lateAction === 'leave' ? v.lateTypeId : ''}
        />
        <input type="hidden" name="earlyOver" value={early ? v.earlyOver : ''} />
        <input type="hidden" name="earlyAction" value={early ? v.earlyAction : 'none'} />
        <input
          type="hidden"
          name="earlyTypeId"
          value={early && v.earlyAction === 'leave' ? v.earlyTypeId : ''}
        />
        <input type="hidden" name="note" value={v.note} />
        {tabs ? (
          <div className="ep-tabs ep-timing__tabs">
            <div role="tablist" aria-label="How to add" className="ep-tabs__list">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'one'}
                className="ep-tabs__tab"
                onClick={() => setMode('one')}
              >
                One employee
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'excel'}
                className="ep-tabs__tab"
                onClick={() => setMode('excel')}
              >
                Many from Excel (bulk)
              </button>
            </div>
          </div>
        ) : null}

        {mode === 'excel' ? (
          <div className="ep-dialog__content ep-weekoff__content">
            <p className="ep-alert ep-alert--info" role="note">
              <span>
                Add or change <strong>many special timings at once</strong>: download the sheet,
                fill one row per employee and dates, upload it and press Check. Every row is checked
                as this form checks it; only the good rows are saved.
              </span>
            </p>
            <SpecialTimingImport />
          </div>
        ) : (
          <div className="ep-dialog__content ep-weekoff__content">
            <p className="ep-alert ep-alert--info" role="note">
              <span>
                {dept ? (
                  <>
                    These times apply to <strong>everyone in the department</strong> who has no
                    special timing of their own. An employee who moves department picks up the new
                    times automatically.
                  </>
                ) : (
                  <>
                    These times apply to <strong>one employee, for the dates given</strong> (a duty,
                    a late bus). A special timing comes before the department timing and the shift.
                  </>
                )}
              </span>
            </p>
            {tried && count ? (
              <p className="ep-alert ep-alert--danger" role="alert">
                <span>
                  {count === 1 ? 'One box needs' : `${String(count)} boxes need`} correcting: see
                  the red notes below.
                </span>
              </p>
            ) : null}

            <h4 className="ep-kicker ep-weekoff__section">Who</h4>
            {dept ? (
              <div>
                {row ? (
                  <div className="ep-field">
                    <span className="ep-field__label">Department</span>
                    <strong>{row.department}</strong>
                    <span className="ep-field__help">
                      To time another department, add a timing for it.
                    </span>
                  </div>
                ) : (
                  <>
                    <ChipPicker
                      label="Department"
                      required
                      options={d.departments
                        .filter((x) => !taken.has(x.toLowerCase()))
                        .map((x) => ({ value: x, label: x }))}
                      value={v.departments}
                      onChange={(next) => {
                        set('departments', next);
                        touch('departments');
                      }}
                      placeholder="Select department(s)"
                      help="Pick one or several — the same times are saved for each."
                    />
                    {show('departments') ? (
                      <span
                        className="ep-field__error"
                        id="tf-departments"
                        role="alert"
                        tabIndex={-1}
                      >
                        {errors.departments}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="ep-shift__row">
                <div>
                  <SearchPick
                    label="Employee"
                    required
                    options={d.employees.map((x) => ({ value: x.id, label: x.name }))}
                    value={v.employeeId}
                    onChange={(x) => {
                      set('employeeId', x);
                      touch('employeeId');
                    }}
                  />
                  {show('employeeId') ? (
                    <span className="ep-field__error" id="tf-employeeId" role="alert" tabIndex={-1}>
                      {errors.employeeId}
                    </span>
                  ) : null}
                </div>
                {field('from', 'From date', box('from', { type: 'date' }), undefined, true)}
                {field('to', 'To date', box('to', { type: 'date' }), undefined, true)}
              </div>
            )}

            <h4 className="ep-kicker ep-weekoff__section">Working times</h4>
            <div className="ep-shift__row">
              {field('startsAt', 'Start time', box('startsAt', { type: 'time' }), undefined, true)}
              {field(
                'endsAt',
                'End time',
                box('endsAt', { type: 'time' }),
                win && win > 0 ? `The working times are ${hours(win / 60)}.` : undefined,
                true,
              )}
              {field(
                'grace',
                'Grace minutes',
                box('grace', { type: 'number', step: '1', mode: 'numeric' }),
                'Late counts only after the start time + the grace.',
              )}
            </div>

            <h4 className="ep-kicker ep-weekoff__section">Hours that decide the day</h4>
            <p className="ep-alert ep-alert--info" role="note">
              <span>
                Worked hours against these thresholds decide the day type:{' '}
                <strong>
                  at or above Present = P, at or above Half-day = HD, below Half-day = A
                </strong>
                . Decimal hours — 7 h 30 m is <code>7.50</code>.
              </span>
            </p>
            <div className="ep-shift__row">
              {field(
                'presentHours',
                'Present hours',
                box('presentHours', { type: 'number', step: '0.25', mode: 'decimal' }),
                present ? `${present} or more = P` : undefined,
                true,
              )}
              {field(
                'halfDayHours',
                'Half-day hours',
                box('halfDayHours', { type: 'number', step: '0.25', mode: 'decimal' }),
                half && present ? `${half} up to ${present} = HD, under ${half} = A` : undefined,
                true,
              )}
              <div className="ep-field">
                <label className="ep-field__label" htmlFor="tf-absent">
                  Absent hours
                </label>
                <input
                  id="tf-absent"
                  className="ep-input ep-input--readonly"
                  readOnly
                  value={half ? `under ${half}` : ''}
                  aria-describedby="tf-absent-help"
                />
                <span className="ep-field__help" id="tf-absent-help">
                  Reference only — under Half-day hours is already Absent.
                </span>
              </div>
            </div>

            <p className="ep-alert ep-alert--info" role="note">
              <span>
                <strong>Late / early threshold rule.</strong> Past these limits the day itself
                changes, whatever the hours say, and the change also <strong>costs leave</strong> —
                charged through the deduction order and shown in the Leave register as charged by
                the system. <code>0</code> minutes or <em>No rule</em> switches that side off. A
                rule can only make a day <strong>worse</strong>, never better.{' '}
                {dept
                  ? 'These apply to everyone in the department who has no special timing of their own.'
                  : 'These apply to this employee on these dates.'}
              </span>
            </p>
            {ruleRow('late')}
            {ruleRow('early')}

            {field(
              'note',
              'Remark',
              box('note', {
                placeholder: dept
                  ? 'e.g. Transport staff — early start'
                  : 'e.g. Exam duty this week',
              }),
            )}
          </div>
        )}
        <div className="ep-dialog__actions ep-weekoff__actions">
          <Button type="button" variant="secondary" onClick={close}>
            {mode === 'excel' ? 'Close' : 'Cancel'}
          </Button>
          {mode === 'one' ? <Button type="submit">Save Timing</Button> : null}
        </div>
      </form>
    </dialog>
  );
}
