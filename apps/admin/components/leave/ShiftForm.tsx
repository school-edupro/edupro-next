'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@edupro/ui';
import { masterSave } from '@/lib/actions';

type Values = Record<string, string | null | undefined>;
type Action = 'none' | 'HD' | 'A' | 'leave';

const FIELDS = [
  'code',
  'name',
  'kind',
  'colour',
  'starts_at',
  'ends_at',
  'grace_minutes',
  'present_hours',
  'half_day_hours',
  'total_hours',
  'overtime',
  'overtime_limit',
  'bus_duty',
  'single_punch',
  'late_over_minutes',
  'late_action',
  'late_leave_type_id',
  'early_over_minutes',
  'early_action',
  'early_leave_type_id',
] as const;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;
/** the colours a shift can take in the shift calendar */
export const SHIFT_COLOURS: Array<{ value: string; label: string }> = [
  { value: '#2563EB', label: 'Blue' },
  { value: '#16A34A', label: 'Green' },
  { value: '#D97706', label: 'Amber' },
  { value: '#7C3AED', label: 'Purple' },
  { value: '#0D9488', label: 'Teal' },
  { value: '#E11D48', label: 'Rose' },
  { value: '#EA580C', label: 'Orange' },
  { value: '#4F46E5', label: 'Indigo' },
  { value: '#0891B2', label: 'Cyan' },
  { value: '#475569', label: 'Slate' },
];
const ACTIONS: Array<{ value: Action; label: string }> = [
  { value: 'none', label: 'No rule' },
  { value: 'HD', label: 'Half day (half a day of leave charged)' },
  { value: 'A', label: 'Absent (a day of leave charged)' },
  { value: 'leave', label: 'Half day of a leave type I choose' },
];
const hhmm = (v: string | null | undefined) => (v ?? '').slice(0, 5);
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
/** 6.25 → "6 h 15 m" */
const hours = (v: string) => {
  const n = num(v);
  if (!Number.isFinite(n)) return '';
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${String(h)} h ${String(m)} m` : `${String(h)} h`;
};
const minutesBetween = (a: string, b: string, night: boolean) => {
  if (!/^\d\d:\d\d$/.test(a) || !/^\d\d:\d\d$/.test(b)) return null;
  const [ah, am] = a.split(':').map(Number) as [number, number];
  const [bh, bm] = b.split(':').map(Number) as [number, number];
  let d = bh * 60 + bm - (ah * 60 + am);
  if (night && d <= 0) d += 24 * 60;
  return d;
};

/**
 * Add or edit a shift (Leave & attendance set-up → Shifts) in a dialog laid out like the old module: the
 * window, the hours that decide the day, overtime and bus duty, the late / early rule, the single-punch
 * policy — every box checked as it is typed and again on save. Posts the fields of the masters form.
 */
export function ShiftForm({
  master,
  back,
  id,
  initial,
  leaveTypes,
}: {
  master: string;
  back: string;
  id?: string;
  initial: Values;
  leaveTypes: Array<{ value: string; label: string | null }>;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const yes = (v: string | null | undefined) => v === 'true' || v === 'yes';
  const [v, setV] = useState({
    code: initial.code ?? '',
    name: initial.name ?? '',
    kind: initial.kind === 'night' ? 'night' : 'day',
    colour: (initial.colour ?? '').toUpperCase(),
    starts_at: hhmm(initial.starts_at) || '08:00',
    ends_at: hhmm(initial.ends_at) || '15:30',
    grace_minutes: initial.grace_minutes ?? '5',
    present_hours: initial.present_hours ?? '7.00',
    half_day_hours: initial.half_day_hours ?? '3.50',
    total_hours: initial.total_hours ?? '7.50',
    overtime: yes(initial.overtime),
    overtime_limit: initial.overtime_limit ?? '0.00',
    bus_duty: yes(initial.bus_duty),
    single_punch: ['A', 'HD', 'P'].includes(initial.single_punch ?? '')
      ? initial.single_punch!
      : 'A',
    late_over_minutes: initial.late_over_minutes ?? '',
    late_action: (initial.late_action as Action) || 'none',
    late_leave_type_id: initial.late_leave_type_id ?? '',
    early_over_minutes: initial.early_over_minutes ?? '',
    early_action: (initial.early_action as Action) || 'none',
    early_leave_type_id: initial.early_leave_type_id ?? '',
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof v, value: string | boolean) =>
    setV((cur) => ({ ...cur, [k]: value }));
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const close = () => router.push(back);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!v.code.trim()) e.code = 'Enter a shift code.';
    else if (!CODE.test(v.code.trim()))
      e.code = 'Capital letters, digits, _ and - only, up to 30 (for example GEN or BUS).';
    if (!v.name.trim()) e.name = 'Enter the shift name.';
    else if (v.name.trim().length > 100) e.name = 'Up to 100 characters.';
    if (!/^\d\d:\d\d$/.test(v.starts_at)) e.starts_at = 'Enter the start time.';
    if (!/^\d\d:\d\d$/.test(v.ends_at)) e.ends_at = 'Enter the end time.';
    else if (v.ends_at === v.starts_at) e.ends_at = 'The end time must differ from the start time.';
    else if (v.kind === 'day' && v.ends_at < v.starts_at)
      e.ends_at = 'A day shift ends after it starts. Pick Night for a shift past midnight.';
    const int = (k: 'grace_minutes', lo: number, hi: number, label: string) => {
      const n = num(v[k]);
      if (!Number.isInteger(n) || n < lo || n > hi)
        e[k] = `${label}: a whole number from ${lo} to ${hi}.`;
    };
    int('grace_minutes', 0, 240, 'Grace minutes');
    const hrs = (
      k: 'present_hours' | 'half_day_hours' | 'total_hours' | 'overtime_limit',
      label: string,
    ) => {
      const n = num(v[k]);
      if (!Number.isFinite(n)) e[k] = `Enter ${label.toLowerCase()}.`;
      else if (n < 0 || n > 24) e[k] = `${label}: from 0 to 24.`;
      else if (!/^\d{1,2}(\.\d{1,2})?$/.test(v[k].trim()))
        e[k] = `${label}: at most 2 decimals (7 h 30 m is 7.50).`;
    };
    hrs('present_hours', 'Present hours');
    hrs('half_day_hours', 'Half-day hours');
    hrs('total_hours', 'Total hours');
    if (!e.present_hours && num(v.present_hours) <= 0)
      e.present_hours = 'Present hours: more than 0.';
    if (!e.present_hours && !e.half_day_hours && num(v.half_day_hours) >= num(v.present_hours))
      e.half_day_hours = 'Half-day hours must be fewer than the present hours.';
    if (!e.present_hours && !e.total_hours && num(v.total_hours) < num(v.present_hours))
      e.total_hours = 'Total hours (a full shift) cannot be fewer than the present hours.';
    const win = minutesBetween(v.starts_at, v.ends_at, v.kind === 'night');
    if (!e.present_hours && win !== null && win > 0 && num(v.present_hours) * 60 > win)
      e.present_hours = `Present hours are longer than the shift window (${hours(String(win / 60))}).`;
    if (v.overtime) hrs('overtime_limit', 'Overtime limit');
    const rule = (side: 'late' | 'early', label: string) => {
      const mk = `${side}_over_minutes` as const;
      const ak = `${side}_action` as const;
      const lk = `${side}_leave_type_id` as const;
      const raw = v[mk].trim();
      const n = raw === '' ? 0 : num(raw);
      if (!Number.isInteger(n) || n < 0 || n > 720)
        e[mk] = `${label}: a whole number from 0 to 720 (0 = off).`;
      else if (n > 0 && v[ak] === 'none')
        e[ak] = 'Choose what the day becomes, or set the minutes to 0.';
      else if (n === 0 && v[ak] !== 'none')
        e[mk] = 'Give the minutes after which the rule applies.';
      if (v[ak] === 'leave' && !v[lk]) e[lk] = 'Choose the leave type to charge.';
    };
    if (!v.bus_duty) rule('late', 'Late by more than');
    rule('early', 'Left early by more than');
    return e;
  }, [v]);

  const show = (k: string) => (tried || touched[k]) && errors[k];
  const field = (
    k: string,
    label: ReactNode,
    input: ReactNode,
    help?: ReactNode,
    required?: boolean,
  ) => (
    <div className="ep-field">
      <label className="ep-field__label" htmlFor={`sf-${k}`}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {input}
      {show(k) ? (
        <span className="ep-field__error" id={`sf-${k}-err`} role="alert">
          {errors[k]}
        </span>
      ) : help ? (
        <span className="ep-field__help">{help}</span>
      ) : null}
    </div>
  );
  const box = (
    k: keyof typeof v,
    opts: {
      type?: string;
      inputMode?: 'numeric' | 'decimal';
      step?: string;
      readOnly?: boolean;
      upper?: boolean;
      placeholder?: string;
      disabled?: boolean;
    } = {},
  ) => (
    <input
      id={`sf-${k}`}
      className="ep-input"
      type={opts.type ?? 'text'}
      inputMode={opts.inputMode}
      step={opts.step}
      readOnly={opts.readOnly}
      disabled={opts.disabled}
      placeholder={opts.placeholder}
      value={String(v[k])}
      aria-invalid={show(k) ? true : undefined}
      aria-describedby={show(k) ? `sf-${k}-err` : undefined}
      onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
      onBlur={() => touch(k)}
    />
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    setTried(true);
    if (Object.keys(errors).length) {
      e.preventDefault();
      const first = Object.keys(errors)[0];
      document.getElementById(`sf-${first}`)?.focus();
    }
  };

  // what is posted: the masters form's fields; a rule set to 0 minutes is off
  const late = num(v.late_over_minutes) > 0 && !v.bus_duty;
  const early = num(v.early_over_minutes) > 0;
  const posted: Record<string, string> = {
    code: v.code.trim(),
    name: v.name.trim(),
    kind: v.kind,
    colour: v.colour,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    grace_minutes: v.grace_minutes,
    present_hours: v.present_hours,
    half_day_hours: v.half_day_hours,
    total_hours: v.total_hours,
    overtime: v.overtime ? 'yes' : 'no',
    overtime_limit: v.overtime ? v.overtime_limit : '0',
    bus_duty: v.bus_duty ? 'yes' : 'no',
    single_punch: v.single_punch,
    late_over_minutes: late ? v.late_over_minutes : '',
    late_action: late ? v.late_action : 'none',
    late_leave_type_id: late && v.late_action === 'leave' ? v.late_leave_type_id : '',
    early_over_minutes: early ? v.early_over_minutes : '',
    early_action: early ? v.early_action : 'none',
    early_leave_type_id: early && v.early_action === 'leave' ? v.early_leave_type_id : '',
  };
  const count = Object.keys(errors).length;
  const present = hours(v.present_hours);
  const half = hours(v.half_day_hours);
  const win = minutesBetween(v.starts_at, v.ends_at, v.kind === 'night');

  const ruleRow = (side: 'late' | 'early') => {
    const mk = `${side}_over_minutes` as const;
    const ak = `${side}_action` as const;
    const lk = `${side}_leave_type_id` as const;
    const off = side === 'late' && v.bus_duty;
    return (
      <>
        {field(
          mk,
          side === 'late' ? 'Late by more than (minutes)' : 'Left early by more than (minutes)',
          box(mk, { type: 'number', inputMode: 'numeric', step: '1', disabled: off }),
          off ? 'Off: a bus-duty shift is never marked late.' : '0 = off',
        )}
        {field(
          ak,
          'then mark the day',
          <select
            id={`sf-${ak}`}
            className="ep-select"
            value={v[ak]}
            disabled={off}
            aria-invalid={show(ak) ? true : undefined}
            onChange={(e) => set(ak, e.target.value)}
            onBlur={() => touch(ak)}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>,
        )}
        {v[ak] === 'leave' && !off ? (
          field(
            lk,
            'Leave type charged',
            <select
              id={`sf-${lk}`}
              className="ep-select"
              value={v[lk]}
              aria-invalid={show(lk) ? true : undefined}
              onChange={(e) => set(lk, e.target.value)}
              onBlur={() => touch(lk)}
            >
              <option value="">Choose…</option>
              {leaveTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label ? `${t.label} (${t.value})` : t.value}
                </option>
              ))}
            </select>,
            undefined,
            true,
          )
        ) : (
          <div />
        )}
      </>
    );
  };

  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="xl"
      aria-labelledby="sf-title"
      onClose={close}
    >
      <form action={masterSave} onSubmit={submit} noValidate className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="sf-title" className="ep-card__title">
            {id ? 'Edit Shift' : 'Add Shift'}
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <input type="hidden" name="master" value={master} />
        <input type="hidden" name="back" value={back} />
        {id ? <input type="hidden" name="id" value={id} /> : null}
        {FIELDS.map((k) => (
          <input key={k} type="hidden" name="fields" value={k} />
        ))}
        {FIELDS.map((k) => (
          <input key={`f-${k}`} type="hidden" name={`f:${k}`} value={posted[k] ?? ''} />
        ))}

        <div className="ep-dialog__content ep-weekoff__content">
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              A shift is the yardstick every day is measured against: when the person was due in,
              how long a full day is, and what a short day counts as. Change a shift and every
              future day measured by it changes with it — days already marked are not recalculated.
            </span>
          </p>
          {tried && count ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>
                {count === 1 ? 'One box needs' : `${String(count)} boxes need`} correcting: see the
                red notes below.
              </span>
            </p>
          ) : null}

          <div className="ep-shift__row">
            {field(
              'code',
              'Shift code',
              box('code', { readOnly: Boolean(id), upper: true, placeholder: 'GEN' }),
              id
                ? 'The code stays as it is (attendance and uploads use it).'
                : 'For example GEN or BUS.',
              true,
            )}
            {field('name', 'Shift name', box('name', { placeholder: 'General' }), undefined, true)}
            {field(
              'kind',
              'Shift type',
              <select
                id="sf-kind"
                className="ep-select"
                value={v.kind}
                onChange={(e) => set('kind', e.target.value)}
              >
                <option value="day">Day</option>
                <option value="night">Night (may end the next morning)</option>
              </select>,
            )}
            {field(
              'colour',
              'Colour in the shift calendar',
              <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  className="ep-shiftcal__swatch"
                  style={{ background: v.colour || 'var(--surface-subtle)' }}
                />
                <select
                  id="sf-colour"
                  className="ep-select"
                  value={v.colour}
                  onChange={(e) => set('colour', e.target.value)}
                >
                  <option value="">Chosen for me</option>
                  {SHIFT_COLOURS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                  {v.colour && !SHIFT_COLOURS.some((c) => c.value === v.colour) ? (
                    <option value={v.colour}>{v.colour}</option>
                  ) : null}
                </select>
              </span>,
            )}
          </div>

          <h4 className="ep-kicker ep-weekoff__section">The shift window</h4>
          <div className="ep-shift__row">
            {field('starts_at', 'Start time', box('starts_at', { type: 'time' }), undefined, true)}
            {field(
              'ends_at',
              'End time',
              box('ends_at', { type: 'time' }),
              win && win > 0 ? `The window is ${hours(String(win / 60))}.` : undefined,
              true,
            )}
            {field(
              'grace_minutes',
              'Grace minutes',
              box('grace_minutes', { type: 'number', inputMode: 'numeric', step: '1' }),
              'Late counts only after the start time + the grace.',
            )}
          </div>

          <h4 className="ep-kicker ep-weekoff__section">Hours that decide the day</h4>
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              Worked hours are compared with these: <strong>at or above Present hours = P</strong>,{' '}
              <strong>at or above Half-day hours but below Present = HD</strong>,{' '}
              <strong>below Half-day hours = A</strong>. Enter decimal hours — 7 h 30 m is{' '}
              <code>7.50</code>, not 7.30.
            </span>
          </p>
          <div className="ep-shift__row">
            {field(
              'present_hours',
              'Present hours',
              box('present_hours', { type: 'number', inputMode: 'decimal', step: '0.25' }),
              present ? `${present} or more = P` : undefined,
              true,
            )}
            {field(
              'half_day_hours',
              'Half-day hours',
              box('half_day_hours', { type: 'number', inputMode: 'decimal', step: '0.25' }),
              half && present ? `${half} up to ${present} = HD, under ${half} = A` : undefined,
              true,
            )}
            {field(
              'total_hours',
              'Total hours',
              box('total_hours', { type: 'number', inputMode: 'decimal', step: '0.25' }),
              'A full shift: overtime counts only after these hours.',
              true,
            )}
          </div>
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              <strong>Which numbers a day is measured against, in order:</strong> 1. a{' '}
              <em>Special timing</em> for that date → 2. a shift posted for that{' '}
              <em>single date</em> in Shift postings → 3. the <em>Department timing</em> → 4. these
              shift numbers. The shift is the school default; everything above it is an exception
              somebody set on purpose.
            </span>
          </p>
          <div className="ep-shift__row">
            {field(
              'overtime_limit',
              'Overtime limit (hours)',
              box('overtime_limit', {
                type: 'number',
                inputMode: 'decimal',
                step: '0.25',
                disabled: !v.overtime,
              }),
              v.overtime ? '0 = no limit.' : 'Tick Overtime applicable to set it.',
            )}
            <label className="ep-check ep-shift__tick" htmlFor="sf-overtime">
              <input
                id="sf-overtime"
                type="checkbox"
                className="ep-check__box"
                checked={v.overtime}
                onChange={(e) => set('overtime', e.target.checked)}
              />
              <span className="ep-check__text">
                Overtime applicable
                <span className="ep-field__help" style={{ display: 'block' }}>
                  Hours worked beyond the total hours on a present day.
                </span>
              </span>
            </label>
            <label className="ep-check ep-shift__tick" htmlFor="sf-bus_duty">
              <input
                id="sf-bus_duty"
                type="checkbox"
                className="ep-check__box"
                checked={v.bus_duty}
                onChange={(e) => set('bus_duty', e.target.checked)}
              />
              <span className="ep-check__text">
                Bus duty shift
                <span className="ep-field__help" style={{ display: 'block' }}>
                  Never marked late, and the late rule does not apply.
                </span>
              </span>
            </label>
          </div>

          <h4 className="ep-kicker ep-weekoff__section">Late / early rule</h4>
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              Past these limits the day itself changes, whatever the hours say — and the change also{' '}
              <strong>costs leave</strong>, charged to the employee’s own balance in the deduction
              order (shown in the Leave register as charged by the system). Set the minutes to{' '}
              <code>0</code> or the outcome to <em>No rule</em> to switch that side off. A rule can
              only make a day <strong>worse</strong>, never better, and bus-duty shifts are exempt
              from the late side exactly as they are from late marking.
            </span>
          </p>
          <div className="ep-shift__row">{ruleRow('late')}</div>
          <div className="ep-shift__row">{ruleRow('early')}</div>

          <h4 className="ep-kicker ep-weekoff__section">The single-punch policy</h4>
          <div className="ep-shift__row">
            {field(
              'single_punch',
              'A single punch counts as',
              <select
                id="sf-single_punch"
                className="ep-select"
                value={v.single_punch}
                onChange={(e) => set('single_punch', e.target.value)}
              >
                <option value="A">Absent</option>
                <option value="HD">Half day</option>
                <option value="P">Present</option>
              </select>,
              undefined,
              true,
            )}
          </div>
          <p className="ep-alert ep-alert--warning" role="note">
            <span>
              <strong>Decide this one deliberately.</strong> When somebody punches once and never
              punches out, nobody can tell whether they worked the day or left after ten minutes.
              Marking them <em>Absent</em> punishes a teacher who simply forgot to punch out;
              marking them <em>Present</em> pays for a day nobody can show. Both answers are
              defensible, which is why it is set per shift. Bus duty commonly uses Present; general
              staff commonly use Absent with a missing-punch follow-up.
            </span>
          </p>
        </div>
        <div className="ep-dialog__actions ep-weekoff__actions">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit">Save Shift</Button>
        </div>
      </form>
    </dialog>
  );
}
