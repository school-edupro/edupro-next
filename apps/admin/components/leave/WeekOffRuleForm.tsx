'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@edupro/ui';
import { ChipPicker } from '@/components/ChipPicker';
import { masterSave } from '@/lib/actions';
import { SCOPE_LABEL, type LeaveScope } from '@/lib/leave';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKS = ['1st', '2nd', '3rd', '4th', '5th'] as const;
const SCOPE_TYPE: Record<LeaveScope, string> = {
  all: 'All staff',
  department: 'Department',
  designation: 'Designation',
  employee_type: 'Employee type',
  employee: 'Employee',
};
/** the most dates one rule may hold (the database refuses more) */
const MAX_DATES = 366;

type Values = Record<string, string | null | undefined>;

const list = (v: string | null | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const nums = (v: string | null | undefined) =>
  list(v)
    .map(Number)
    .filter((n) => Number.isInteger(n));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** 2026-11-14 → 14 Nov 2026 (Saturday) */
const shown = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        weekday: 'short',
        timeZone: 'UTC',
      });
};

/**
 * Add or edit a weekly-off rule (Leave & attendance set-up → Weekly offs) in a dialog: who it is for,
 * then either a weekly pattern (weekdays, optionally only some weeks of the month) or a list of dates.
 * Posts the same fields as the generic masters form, so the server checks and saves it the same way.
 */
export function WeekOffRuleForm({
  master,
  back,
  id,
  initial,
  scopes,
  staff,
}: {
  master: string;
  back: string;
  /** the row being edited; none when adding */
  id?: string;
  /** the row's values, or what was typed when the server refused the last save */
  initial: Values;
  scopes: Record<Exclude<LeaveScope, 'all'>, string[]>;
  staff: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<LeaveScope>(
    (Object.keys(SCOPE_TYPE) as LeaveScope[]).includes(initial.scope as LeaveScope)
      ? (initial.scope as LeaveScope)
      : 'all',
  );
  const [values, setValues] = useState<string[]>(list(initial.scope_values));
  const [kind, setKind] = useState<'weekly' | 'dates'>(
    initial.kind === 'dates' ? 'dates' : 'weekly',
  );
  const [days, setDays] = useState<number[]>(nums(initial.weekdays));
  const [weeks, setWeeks] = useState<number[]>(nums(initial.week_numbers));
  const [dates, setDates] = useState<string[]>(list(initial.dates).filter((d) => ISO.test(d)));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const close = () => router.push(back);

  const names = new Map(staff.map((s) => [s.code, s.name]));
  const options =
    scope === 'all'
      ? []
      : scopes[scope].map((v) => ({
          value: v,
          label: scope === 'employee' ? `${names.get(v) ?? v} (${v})` : v,
        }));
  // a value kept on the rule that is no longer in the lists still shows (and stays) as a chip
  for (const v of values)
    if (!options.some((o) => o.value === v)) options.push({ value: v, label: v });

  const toggle = (set: number[], n: number) =>
    set.includes(n) ? set.filter((x) => x !== n) : [...set, n].sort((a, b) => a - b);

  const addDates = () => {
    setProblem('');
    if (!from) {
      setProblem('Pick the From date first.');
      return;
    }
    const end = to || from;
    if (end < from) {
      setProblem('The To date is before the From date.');
      return;
    }
    const added: string[] = [];
    for (
      let d = new Date(`${from}T00:00:00Z`);
      d <= new Date(`${end}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    )
      added.push(d.toISOString().slice(0, 10));
    const next = [...new Set([...dates, ...added])].sort();
    if (next.length > MAX_DATES) {
      setProblem(`A rule can hold up to ${MAX_DATES} dates.`);
      return;
    }
    setDates(next);
    setFrom('');
    setTo('');
  };

  const check = (e: FormEvent<HTMLFormElement>) => {
    const why =
      scope !== 'all' && values.length === 0
        ? `Pick at least one ${SCOPE_TYPE[scope].toLowerCase()} under Applies To.`
        : kind === 'weekly' && days.length === 0
          ? 'Tick at least one week day.'
          : kind === 'dates' && dates.length === 0
            ? 'Add at least one date (pick From / To, then Add Date).'
            : '';
    if (why) {
      e.preventDefault();
      setProblem(why);
    }
  };

  const title = id ? 'Edit Week-Off Rule' : 'Add Week-Off Rule';
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="xl"
      aria-labelledby="wo-title"
      onClose={close}
    >
      <form action={masterSave} onSubmit={check} className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id="wo-title" className="ep-card__title">
            {title}
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
        <input type="hidden" name="master" value={master} />
        <input type="hidden" name="back" value={back} />
        {id ? <input type="hidden" name="id" value={id} /> : null}
        {[
          'name',
          'priority',
          'scope',
          'scope_values',
          'kind',
          'weekdays',
          'week_numbers',
          'dates',
        ].map((k) => (
          <input key={k} type="hidden" name="fields" value={k} />
        ))}
        <input type="hidden" name="f:scope" value={scope} />
        <input
          type="hidden"
          name="f:scope_values"
          value={scope === 'all' ? '' : values.join(',')}
        />
        <input type="hidden" name="f:kind" value={kind} />
        <input type="hidden" name="f:weekdays" value={kind === 'weekly' ? days.join(',') : ''} />
        <input
          type="hidden"
          name="f:week_numbers"
          value={kind === 'weekly' ? weeks.join(',') : ''}
        />
        <input type="hidden" name="f:dates" value={kind === 'dates' ? dates.join(',') : ''} />

        <div className="ep-dialog__content ep-weekoff__content">
          <div className="ep-weekoff__row ep-weekoff__row--name">
            <label className="ep-field" htmlFor="wo-name">
              <span className="ep-field__label">
                Rule Name<span aria-hidden="true"> *</span>
              </span>
              <input
                id="wo-name"
                name="f:name"
                className="ep-input"
                required
                maxLength={100}
                placeholder="Sunday Weekly Off"
                defaultValue={initial.name ?? ''}
                aria-describedby="wo-name-help"
              />
              <span id="wo-name-help" className="ep-field__help">
                A short name staff and reports will show, e.g. 2nd &amp; 4th Saturday off.
              </span>
            </label>
            <label className="ep-field" htmlFor="wo-prio">
              <span className="ep-field__label">Priority</span>
              <input
                id="wo-prio"
                name="f:priority"
                className="ep-input"
                type="number"
                min={1}
                max={999}
                step={1}
                defaultValue={initial.priority ?? '100'}
              />
            </label>
          </div>
          <p className="ep-alert ep-alert--info" role="note">
            <span>
              A day is a week-off for an employee when <strong>any</strong> active rule that covers
              them makes it one — rules add up, none overrides another. Priority (1–999) only sets
              the order rules are listed in.
            </span>
          </p>

          <div className="ep-weekoff__row">
            <label className="ep-field" htmlFor="wo-scope">
              <span className="ep-field__label">Scope Type</span>
              <select
                id="wo-scope"
                className="ep-select"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as LeaveScope);
                  setValues([]);
                }}
              >
                {(Object.keys(SCOPE_TYPE) as LeaveScope[]).map((k) => (
                  <option key={k} value={k}>
                    {SCOPE_TYPE[k]}
                  </option>
                ))}
              </select>
            </label>
            {scope === 'all' ? null : (
              <ChipPicker
                label={`Applies To · ${SCOPE_LABEL[scope]}`}
                required
                options={options}
                value={values}
                onChange={setValues}
                help="Type to find; pick one or more."
              />
            )}
          </div>

          <h4 className="ep-kicker ep-weekoff__section">Which days are off</h4>
          <div className="ep-weekoff__row">
            <label className="ep-field" htmlFor="wo-kind">
              <span className="ep-field__label">Rule Kind</span>
              <select
                id="wo-kind"
                className="ep-select"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value === 'dates' ? 'dates' : 'weekly');
                  setProblem('');
                }}
              >
                <option value="weekly">Weekly pattern</option>
                <option value="dates">Specific dates</option>
              </select>
            </label>
          </div>

          {kind === 'weekly' ? (
            <>
              <fieldset className="ep-weekoff__ticks">
                <legend className="ep-field__label">
                  Week Days<span aria-hidden="true"> *</span>
                </legend>
                <div className="ep-weekoff__tickrow">
                  {DAYS.map((d, i) => (
                    <label key={d} className="ep-weekoff__tick">
                      <input
                        type="checkbox"
                        checked={days.includes(i + 1)}
                        onChange={() => setDays(toggle(days, i + 1))}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="ep-weekoff__ticks">
                <legend className="ep-field__label">Week Numbers (optional)</legend>
                <div className="ep-weekoff__tickrow">
                  {WEEKS.map((w, i) => (
                    <label key={w} className="ep-weekoff__tick">
                      <input
                        type="checkbox"
                        checked={weeks.includes(i + 1)}
                        onChange={() => setWeeks(toggle(weeks, i + 1))}
                      />
                      {w}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="ep-alert ep-alert--info" role="note">
                <span>
                  Leave every week number clear for &quot;every week&quot;. Tick 2nd and 4th with
                  Saturday above to get the usual &quot;2nd and 4th Saturday off&quot; pattern. The
                  1st week is days 1–7 of the month, the 2nd days 8–14, and so on.
                </span>
              </p>
            </>
          ) : (
            <>
              <div className="ep-weekoff__row ep-weekoff__row--dates">
                <label className="ep-field" htmlFor="wo-from">
                  <span className="ep-field__label">
                    From Date<span aria-hidden="true"> *</span>
                  </span>
                  <input
                    id="wo-from"
                    className="ep-input"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="ep-field" htmlFor="wo-to">
                  <span className="ep-field__label">To Date</span>
                  <input
                    id="wo-to"
                    className="ep-input"
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                <div className="ep-weekoff__add">
                  <Button type="button" onClick={addDates}>
                    ＋ Add Date
                  </Button>
                </div>
              </div>
              <div className="ep-field">
                <span className="ep-field__label" id="wo-dates">
                  Dates in this rule<span aria-hidden="true"> *</span>
                  {dates.length ? ` (${dates.length})` : ''}
                </span>
                {dates.length ? (
                  <ul className="ep-chips" aria-labelledby="wo-dates">
                    {dates.map((d) => (
                      <li key={d}>
                        {shown(d)}
                        <button
                          type="button"
                          className="ep-chips__x"
                          aria-label={`Remove ${shown(d)}`}
                          onClick={() => setDates(dates.filter((x) => x !== d))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="ep-field__help">No dates yet.</span>
                )}
              </div>
              <p className="ep-alert ep-alert--info" role="note">
                <span>
                  Leave To Date empty to add one day; fill it to add every day from From to To. Use
                  this for rotating offs. On the attendance register a past day with no attendance
                  entry is shown as a week-off (WO); a day already marked (P / HD / A / leave) keeps
                  its mark.
                </span>
              </p>
            </>
          )}
          {problem ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              <span>{problem}</span>
            </p>
          ) : null}
        </div>
        <div className="ep-dialog__actions ep-weekoff__actions">
          <Button type="button" variant="secondary" onClick={close}>
            Close
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </dialog>
  );
}
