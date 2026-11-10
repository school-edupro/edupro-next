'use client';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { dmy, type ShiftAssignResult, type ShiftCalendar, type ShiftCopyResult } from '@/lib/leave';
import { assignShifts, clearShiftDay, copyShiftMonth } from '@/lib/leave-actions';

type Row = ShiftCalendar['rows'][number];
type Cell = Row['cells'][number];
type Open =
  | null
  | { kind: 'assign'; ids: string[]; from?: string }
  | { kind: 'day'; row: Row; i: number }
  | { kind: 'copy' };

const SRC: Record<Cell['src'], string> = {
  posted: 'posted',
  default: 'the default shift (none posted)',
  day: 'posted for this day only',
};
const prevMonth = (m: string) => {
  const [y, n] = m.split('-').map(Number) as [number, number];
  return n === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(n - 1).padStart(2, '0')}`;
};
const nextMonth = (m: string) => {
  const [y, n] = m.split('-').map(Number) as [number, number];
  return n === 12 ? `${String(y + 1)}-01` : `${String(y)}-${String(n + 1).padStart(2, '0')}`;
};

/** A dialog that opens as it mounts; Esc or × closes it. */
function Modal({
  id,
  title,
  onClose,
  children,
  actions,
}: {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ep-dialog ep-weekoff"
      data-size="lg"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
    >
      <div className="ep-dialog__body">
        <div className="ep-weekoff__head">
          <h3 id={`${id}-title`} className="ep-card__title">
            {title}
          </h3>
          <button type="button" className="ep-chips__x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ep-dialog__content ep-weekoff__content">{children}</div>
        <div className="ep-weekoff__actions">{actions}</div>
      </div>
    </dialog>
  );
}

/** What would change (or changed), employee by employee. */
function Lines({ lines }: { lines: Array<{ employee: string; changes: string[] }> }) {
  if (!lines.length) return null;
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="What changes">
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            <th scope="col">Employee</th>
            <th scope="col">Shifts</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.employee}>
              <td>{l.employee}</td>
              <td>
                <ul className="ep-approvers">
                  {l.changes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The shift calendar's grid: an employee a line, a day a column, each day's shift code in its colour (WO
 * weekly off, H holiday; a dashed box: the default shift, none posted; a dot: a shift for that day only).
 * Tick employees and post a shift for days; click a day to change that day only; copy a month onto another.
 */
export function ShiftCalendarGrid({
  cal,
  can,
  q,
  department,
}: {
  cal: ShiftCalendar;
  can: boolean;
  q: string;
  department: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Open>(null);
  const [said, setSaid] = useState<string | null>(null);
  const shift = useMemo(() => new Map(cal.shifts.map((s) => [s.id, s])), [cal.shifts]);
  const all = cal.rows.length > 0 && cal.rows.every((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const done = (text: string) => {
    setOpen(null);
    setPicked(new Set());
    setSaid(text);
    router.refresh();
  };
  const word = (r: Row, i: number) => {
    const c = r.cells[i]!;
    const d = cal.days[i]!;
    const s = c.s ? shift.get(c.s) : undefined;
    return `${r.name}, ${d.dow} ${dmy(d.date)}: ${s ? `${s.code} ${s.name} ${s.starts_at}–${s.ends_at}` : 'no shift'} (${SRC[c.src]})${c.wo ? ', weekly off' : ''}${c.h ? ', holiday' : ''}`;
  };

  return (
    <>
      {said ? (
        <p className="ep-alert ep-alert--success" role="status">
          <span>{said}</span>
        </p>
      ) : null}
      {can ? (
        <div className="ep-shiftcal__bar">
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={!picked.size}
            onClick={() => setOpen({ kind: 'assign', ids: [...picked] })}
          >
            Assign shift{picked.size ? ` to ${String(picked.size)} ticked` : ''}
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setOpen({ kind: 'copy' })}
          >
            Copy a month…
          </button>
          <span className="ep-field__help">
            {picked.size
              ? `${String(picked.size)} employee${picked.size === 1 ? '' : 's'} ticked.`
              : 'Tick employees to post a shift to them, or click a day to change that day only.'}
          </span>
        </div>
      ) : null}

      <div
        className="ep-table-wrap ep-shiftcal"
        tabIndex={0}
        role="region"
        aria-label="Shift calendar"
      >
        <table className="ep-table ep-table--dense ep-shiftcal__table">
          <caption className="ep-sr-only">Shift of each employee for each day of the month</caption>
          <thead>
            <tr>
              {can ? (
                <th scope="col" className="ep-shiftcal__tick">
                  <input
                    type="checkbox"
                    aria-label="Tick every employee on this page"
                    checked={all}
                    onChange={() => setPicked(all ? new Set() : new Set(cal.rows.map((r) => r.id)))}
                  />
                </th>
              ) : null}
              <th scope="col" className="ep-shiftcal__who">
                Employee
              </th>
              {cal.days.map((d) => (
                <th
                  key={d.date}
                  scope="col"
                  className={`ep-shiftcal__day${d.dow === 'Sun' ? ' ep-shiftcal__day--sun' : ''}${d.date === cal.today ? ' ep-shiftcal__day--today' : ''}`}
                  title={dmy(d.date)}
                >
                  <span>{d.day}</span>
                  <span className="ep-shiftcal__dow">{d.dow.slice(0, 2)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cal.rows.length === 0 ? (
              <tr>
                <td colSpan={cal.days.length + (can ? 2 : 1)} className="ep-field__help">
                  No employee matches these filters.
                </td>
              </tr>
            ) : null}
            {cal.rows.map((r) => (
              <tr key={r.id}>
                {can ? (
                  <td className="ep-shiftcal__tick">
                    <input
                      type="checkbox"
                      aria-label={`Tick ${r.name}`}
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                ) : null}
                <th scope="row" className="ep-shiftcal__who">
                  <strong>{r.name}</strong>
                  <span className="ep-mr-col__desc">
                    {r.code}
                    {r.department ? ` · ${r.department}` : ''}
                    {r.posted ? null : <span className="ep-shiftcal__tag">No shift posted</span>}
                  </span>
                </th>
                {r.cells.map((c, i) => {
                  const s = c.s ? shift.get(c.s) : undefined;
                  const text = c.h ? 'H' : c.wo ? 'WO' : (s?.code ?? '—');
                  const cls = `ep-shiftcal__cell ep-shiftcal__cell--${c.h ? 'h' : c.wo ? 'wo' : c.src}`;
                  const style = s ? ({ '--sc': s.colour } as CSSProperties) : undefined;
                  return (
                    <td
                      key={cal.days[i]!.date}
                      className={cal.days[i]!.date === cal.today ? 'ep-shiftcal__today' : undefined}
                    >
                      {can ? (
                        <button
                          type="button"
                          className={cls}
                          style={style}
                          title={word(r, i)}
                          aria-label={word(r, i)}
                          onClick={() => setOpen({ kind: 'day', row: r, i })}
                        >
                          {text}
                        </button>
                      ) : (
                        <span className={cls} style={style} title={word(r, i)}>
                          {text}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open?.kind === 'assign' ? (
        <AssignDialog
          cal={cal}
          ids={open.ids}
          from={open.from}
          names={cal.rows.filter((r) => open.ids.includes(r.id)).map((r) => r.name)}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
      {open?.kind === 'day' ? (
        <DayDialog
          cal={cal}
          row={open.row}
          i={open.i}
          onClose={() => setOpen(null)}
          onDone={done}
          onRange={(from) => setOpen({ kind: 'assign', ids: [open.row.id], from })}
        />
      ) : null}
      {open?.kind === 'copy' ? (
        <CopyDialog
          cal={cal}
          q={q}
          department={department}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

function ShiftSelect({
  id,
  cal,
  value,
  onChange,
  label,
}: {
  id: string;
  cal: ShiftCalendar;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">
        {label} <span aria-hidden="true">*</span>
      </span>
      <select
        id={id}
        className="ep-select"
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a shift…</option>
        {cal.shifts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name} ({s.starts_at}–{s.ends_at})
          </option>
        ))}
      </select>
    </label>
  );
}

function AssignDialog({
  cal,
  ids,
  names,
  from: from0,
  onClose,
  onDone,
}: {
  cal: ShiftCalendar;
  ids: string[];
  names: string[];
  from?: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const monthEnd = cal.days[cal.days.length - 1]!.date;
  const start = from0 ?? (cal.today.slice(0, 7) === cal.month ? cal.today : cal.days[0]!.date);
  const [shiftId, setShift] = useState('');
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ShiftAssignResult | null>(null);
  const [pending, run] = useTransition();
  const bad = !shiftId
    ? 'Choose the shift.'
    : !from
      ? 'Give the From date.'
      : to && to < from
        ? 'The To date is on or after the From date.'
        : null;
  const go = (dryRun: boolean) =>
    run(async () => {
      setError(null);
      const r = await assignShifts({ employeeIds: ids, shiftId, from, to: to || null, dryRun });
      if (!r.ok) {
        setError(r.error);
        setCheck(null);
        return;
      }
      if (dryRun) {
        setCheck(r.r);
        return;
      }
      onDone(
        `${r.r.shift} posted to ${String(r.r.changed)} employee${r.r.changed === 1 ? '' : 's'}${r.r.same ? ` (${String(r.r.same)} had it already)` : ''}${r.r.worked ? `; ${String(r.r.worked)} past days worked out again` : ''}.`,
      );
    });
  const reset = () => setCheck(null);
  return (
    <Modal
      id="sc-assign"
      title="Assign shift"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={Boolean(bad) || pending}
            onClick={() => go(true)}
          >
            {pending && !check ? 'Checking…' : 'Check'}
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={Boolean(bad) || pending || !check || check.changed === 0}
            onClick={() => go(false)}
          >
            {pending && check ? 'Posting…' : 'Post shift'}
          </button>
        </>
      }
    >
      <p className="ep-field__help">
        For{' '}
        {names.length === ids.length && names.length <= 6
          ? names.join(', ')
          : `${String(ids.length)} employees`}
        . What is posted inside these days gives way; outside them nothing changes.
      </p>
      <ShiftSelect
        id="sc-shift"
        cal={cal}
        label="Shift"
        value={shiftId}
        onChange={(v) => {
          setShift(v);
          reset();
        }}
      />
      <div className="ep-shift__row">
        <label className="ep-field" htmlFor="sc-from">
          <span className="ep-field__label">
            From <span aria-hidden="true">*</span>
          </span>
          <input
            id="sc-from"
            type="date"
            className="ep-input"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              reset();
            }}
          />
        </label>
        <label className="ep-field" htmlFor="sc-to">
          <span className="ep-field__label">To</span>
          <input
            id="sc-to"
            type="date"
            className="ep-input"
            min={from || undefined}
            value={to}
            aria-describedby="sc-to-help"
            onChange={(e) => {
              setTo(e.target.value);
              reset();
            }}
          />
          <span id="sc-to-help" className="ep-field__help">
            Empty: until changed.
          </span>
        </label>
        <div
          className="ep-shift__tick"
          style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              setTo(from);
              reset();
            }}
          >
            That day only
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              setTo(monthEnd);
              reset();
            }}
          >
            To month end
          </button>
        </div>
      </div>
      {from && from < cal.today ? (
        <p className="ep-alert ep-alert--warning" role="note">
          <span>
            From a past date: those days are worked out again with the new shift (never in a month
            locked for payroll).
          </span>
        </p>
      ) : null}
      {bad && (shiftId || error) ? <p className="ep-field__error">{bad}</p> : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{error}</span>
        </p>
      ) : null}
      {check ? (
        <>
          <p className="ep-alert ep-alert--info" role="status">
            <span>
              {check.changed
                ? `${check.shift} for ${String(check.changed)} employee${check.changed === 1 ? '' : 's'}`
                : 'Nothing to change'}
              {check.same ? ` · ${String(check.same)} have exactly this already` : ''}. Press Post
              shift to save.
            </span>
          </p>
          <Lines lines={check.lines} />
        </>
      ) : null}
    </Modal>
  );
}

function DayDialog({
  cal,
  row,
  i,
  onClose,
  onDone,
  onRange,
}: {
  cal: ShiftCalendar;
  row: Row;
  i: number;
  onClose: () => void;
  onDone: (text: string) => void;
  onRange: (from: string) => void;
}) {
  const c = row.cells[i]!;
  const d = cal.days[i]!;
  const now = c.s ? cal.shifts.find((s) => s.id === c.s) : undefined;
  const [shiftId, setShift] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const locked = cal.locked && d.date < cal.today;
  const post = () =>
    run(async () => {
      setError(null);
      const r = await assignShifts({
        employeeIds: [row.id],
        shiftId,
        from: d.date,
        to: d.date,
        dryRun: false,
      });
      if (!r.ok) return setError(r.error);
      onDone(`${row.name}: ${r.r.shift} on ${dmy(d.date)} only.`);
    });
  const clear = () =>
    run(async () => {
      setError(null);
      const r = await clearShiftDay({ employeeId: row.id, day: d.date });
      if (!r.ok) return setError(r.error);
      onDone(`${row.name}: ${dmy(d.date)} follows the shift around it again.`);
    });
  return (
    <Modal
      id="sc-day"
      title={`${row.name} · ${d.dow} ${dmy(d.date)}`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={pending || locked}
            onClick={() => onRange(d.date)}
          >
            Post from this day…
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={!shiftId || (shiftId === c.s && c.src === 'day') || pending || locked}
            onClick={post}
          >
            {pending ? 'Saving…' : 'Save for this day'}
          </button>
        </>
      }
    >
      <dl className="ep-shiftcal__facts">
        <dt>Shift now</dt>
        <dd>
          {now ? (
            <>
              <span
                className="ep-shiftcal__swatch"
                style={{ background: now.colour }}
                aria-hidden="true"
              />{' '}
              <strong>{now.code}</strong> — {now.name} ({now.starts_at}–{now.ends_at})
            </>
          ) : (
            'No shift'
          )}
          <span className="ep-mr-col__desc">{SRC[c.src]}</span>
        </dd>
        {c.wo || c.h ? (
          <>
            <dt>Day</dt>
            <dd>
              {[c.wo ? 'Weekly off' : null, c.h ? 'Holiday' : null].filter(Boolean).join(' and ')}
            </dd>
          </>
        ) : null}
      </dl>
      {locked ? (
        <p className="ep-alert ep-alert--warning" role="note">
          <span>This month is locked for payroll: its days cannot change.</span>
        </p>
      ) : (
        <>
          <ShiftSelect
            id="sc-day-shift"
            cal={cal}
            label="Shift for this day only"
            value={shiftId}
            onChange={setShift}
          />
          <p className="ep-field__help">
            A shift for one day keeps that shift’s own hours on that day (not the department
            timing).
            {d.date < cal.today ? ' A past day is worked out again.' : ''}
          </p>
          {c.src === 'day' ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={pending}
              onClick={clear}
            >
              Take this day back to the shift around it
            </button>
          ) : null}
        </>
      )}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{error}</span>
        </p>
      ) : null}
    </Modal>
  );
}

function CopyDialog({
  cal,
  q,
  department,
  onClose,
  onDone,
}: {
  cal: ShiftCalendar;
  q: string;
  department: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [source, setSource] = useState(prevMonth(cal.month));
  const [target, setTarget] = useState(cal.month);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<ShiftCopyResult | null>(null);
  const [pending, run] = useTransition();
  const ok = /^\d{4}-\d{2}$/.test(source) && /^\d{4}-\d{2}$/.test(target);
  const bad = !ok ? 'Choose both months.' : source === target ? 'Copy onto another month.' : null;
  const go = (dryRun: boolean) =>
    run(async () => {
      setError(null);
      const r = await copyShiftMonth({
        source,
        target,
        ...(q ? { q } : {}),
        ...(department ? { department } : {}),
        dryRun,
      });
      if (!r.ok) {
        setCheck(null);
        return setError(r.error);
      }
      if (dryRun) return setCheck(r.r);
      onDone(
        `${r.r.source} copied onto ${r.r.target}: ${String(r.r.copied)} employee${r.r.copied === 1 ? '' : 's'}, ${String(r.r.postings)} posting${r.r.postings === 1 ? '' : 's'}${r.r.skipped.length ? `; ${String(r.r.skipped.length)} left as they were (shifts posted already)` : ''}.`,
      );
    });
  return (
    <Modal
      id="sc-copy"
      title="Copy a month’s shifts"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={Boolean(bad) || pending}
            onClick={() => go(true)}
          >
            {pending && !check ? 'Checking…' : 'Preview'}
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={Boolean(bad) || pending || !check || check.copied === 0}
            onClick={() => go(false)}
          >
            {pending && check ? 'Copying…' : 'Copy'}
          </button>
        </>
      }
    >
      <p className="ep-field__help">
        The shifts posted in one month go onto the other, date for date
        {q || department
          ? ` — for the employees of the filter (${[department, q].filter(Boolean).join(', ')})`
          : ' — for every employee'}
        . Staff with a shift posted in the target month already are left as they are.
      </p>
      <div className="ep-shift__row">
        <label className="ep-field" htmlFor="sc-source">
          <span className="ep-field__label">
            Copy the shifts of <span aria-hidden="true">*</span>
          </span>
          <input
            id="sc-source"
            type="month"
            className="ep-input"
            required
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setCheck(null);
            }}
          />
        </label>
        <label className="ep-field" htmlFor="sc-target">
          <span className="ep-field__label">
            Onto <span aria-hidden="true">*</span>
          </span>
          <input
            id="sc-target"
            type="month"
            className="ep-input"
            required
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setCheck(null);
            }}
          />
        </label>
        <div className="ep-shift__tick">
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              setSource(cal.month);
              setTarget(nextMonth(cal.month));
              setCheck(null);
            }}
          >
            This month onto the next
          </button>
        </div>
      </div>
      {bad && error === null && source && target && source === target ? (
        <p className="ep-field__error">{bad}</p>
      ) : null}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{error}</span>
        </p>
      ) : null}
      {check ? (
        <>
          <p className="ep-alert ep-alert--info" role="status">
            <span>
              {check.copied
                ? `${String(check.copied)} employee${check.copied === 1 ? '' : 's'}, ${String(check.postings)} posting${check.postings === 1 ? '' : 's'} from ${check.source} onto ${check.target}.`
                : `Nothing to copy from ${check.source}.`}
              {check.nothing
                ? ` ${String(check.nothing)} had no shift posted in ${check.source} (the default shift).`
                : ''}
              {check.skipped.length
                ? ` ${String(check.skipped.length)} left as they are (shifts posted in ${check.target} already): ${check.skipped.slice(0, 8).join(', ')}${check.skipped.length > 8 ? '…' : ''}.`
                : ''}
            </span>
          </p>
          <Lines lines={check.lines} />
        </>
      ) : null}
    </Modal>
  );
}
