'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { importAttendanceSheet, type SheetResult } from '@/lib/leave-actions';

type Tab = 'sheet' | 'screen' | 'punches';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sheet', label: 'From a spreadsheet' },
  { id: 'screen', label: 'On screen' },
  { id: 'punches', label: 'Punches from a spreadsheet' },
];
const STATUSES: Array<[string, string]> = [
  ['P', 'P — Present'],
  ['HD', 'HD — Half day'],
  ['A', 'A — Absent'],
  ['WO', 'WO — Weekly off'],
  ['H', 'H — Holiday'],
];

/**
 * Bulk Attendance Update (docs/design/85, as the old module's dialog): the days from a spreadsheet —
 * the rules, the template, a Default Reason, the file, Preview & Validate, then save the good rows — and
 * two more tabs in the same style: the days set on screen (employees or a department, dates, a status)
 * and the punches the device could not send.
 */
export function BulkAttendance({
  employees,
  departments,
  back,
  today,
  from,
  to,
  bulk,
}: {
  employees: Array<{ id: string; name: string; code: string; department: string | null }>;
  departments: string[];
  back: string;
  today: string;
  from: string;
  to: string;
  /** the on-screen form's server action */
  bulk: (fd: FormData) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('sheet');
  return (
    <div className="ep-bulk">
      <div
        role="tablist"
        aria-label="How to update"
        className="ep-tabs__list"
        style={{ margin: 0 }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`bk-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`bk-panel-${t.id}`}
            className="ep-tabs__tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="bk-panel-sheet"
        aria-labelledby="bk-tab-sheet"
        hidden={tab !== 'sheet'}
      >
        <SheetFlow what="days" />
      </div>
      <div
        role="tabpanel"
        id="bk-panel-screen"
        aria-labelledby="bk-tab-screen"
        hidden={tab !== 'screen'}
      >
        <OnScreen
          employees={employees}
          departments={departments}
          back={back}
          today={today}
          from={from}
          to={to}
          bulk={bulk}
        />
      </div>
      <div
        role="tabpanel"
        id="bk-panel-punches"
        aria-labelledby="bk-tab-punches"
        hidden={tab !== 'punches'}
      >
        <SheetFlow what="punches" />
      </div>
      <form method="dialog" className="ep-bulk__foot">
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Cancel
        </button>
      </form>
    </div>
  );
}

/** The days (or punches) from a spreadsheet: rules, template, Default Reason, file, preview, save. */
function SheetFlow({ what }: { what: 'days' | 'punches' }) {
  const router = useRouter();
  const [file, setFile] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<SheetResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result : null;
  const good = ok ? ok.rows.filter((r) => r.ok).length : 0;
  const skipped = ok ? ok.rows.filter((r) => !r.ok && r.error?.startsWith('skipped')).length : 0;
  const bad = ok ? ok.rows.length - good - skipped : 0;
  const id = `bk-${what}`;
  const days = what === 'days';
  const read = (f: File | undefined) => {
    setResult(null);
    if (!f) return setFile(null);
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      setFile(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(f);
  };
  const go = (dryRun: boolean) =>
    start(async () => {
      if (!file) return;
      const r = await importAttendanceSheet(what, file, dryRun, days ? reason.trim() : undefined);
      setResult(r);
      if (r.ok && !dryRun) router.refresh();
    });
  const ready = !!file && (!days || reason.trim().length >= 3);
  return (
    <div className="ep-bulk">
      {days ? (
        <>
          <p className="ep-note">
            <strong>One row = one employee on one day.</strong> Marks{' '}
            <strong>P / HD / A / WO / H / HOLD</strong> in bulk from a spreadsheet. Every day
            written is marked <strong>Manual</strong>, so the nightly run will not overwrite it
            afterwards, and the reason is stored on the day and audited.
          </p>
          <p className="ep-note ep-note--warn">
            <strong>This never cancels leave.</strong> A date that already carries a waiting or
            approved leave is <strong>skipped</strong>, and the preview names every one of them —
            correct those on the day instead, one at a time.{' '}
            <strong>Leave and LOP cannot be imported</strong> either: they go through Apply Leave so
            the balance and the leave register stay correct.
          </p>
        </>
      ) : (
        <p className="ep-note">
          <strong>One row = one employee on one day</strong>, with the IN and OUT the device could
          not send (or one of them). They join the punches, and the day is worked out from them as
          from the device. A day set by hand keeps what was set.
        </p>
      )}
      <div>
        <p className="ep-bulk__label">Column rules:</p>
        <ul className="ep-bulk__rules">
          <li>
            <strong>Employee</strong> (or EmpId) — required; the code must match an active employee.
          </li>
          <li>
            <strong>Date</strong> — required; YYYY-MM-DD (or DD-MM-YYYY). Repeat the employee for
            each date.
          </li>
          {days ? (
            <li>
              <strong>Day type</strong> (or DayType) — one of <strong>P</strong> (present),{' '}
              <strong>HD</strong> (half day), <strong>A</strong> (absent), <strong>WO</strong>{' '}
              (weekly off), <strong>H</strong> (holiday), <strong>HOLD</strong>; blank works the day
              out from the times.
            </li>
          ) : null}
          <li>
            <strong>In / Out</strong> (or InTime / OutTime) — {days ? 'optional' : 'one at least'},
            HH:MM 24-hour.{days ? ' Blank leaves the punch as it is.' : ''}
          </li>
          {days ? (
            <li>
              <strong>Reason</strong> — optional per row; the Default Reason below is used when it
              is blank.
            </li>
          ) : null}
          <li>
            Days to come and months locked for payroll are refused. Delete the template’s sample row
            first.
          </li>
        </ul>
      </div>
      <div className="ep-bulk__row">
        <a
          className="ep-btn ep-btn--primary ep-btn--sm"
          href={`/api/leave/attendance-format?what=${what}`}
          download
        >
          Download Template
        </a>
        <span className="ep-field__help" style={{ margin: 0 }}>
          Headers + a sample row, with every employee in the list (.xlsx)
        </span>
      </div>
      {days ? (
        <label className="ep-field" htmlFor={`${id}-reason`}>
          <span className="ep-field__label">
            Default Reason <span aria-hidden="true">*</span>
          </span>
          <input
            id={`${id}-reason`}
            className="ep-input"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setResult(null);
            }}
            maxLength={300}
            required
            aria-describedby={`${id}-reason-help`}
            placeholder="e.g. Biometric device down on 12–13 Nov — attendance declared by the principal"
          />
          <span id={`${id}-reason-help`} className="ep-field__help">
            Used for every row whose Reason cell is blank. Stored on the day and audited.
          </span>
        </label>
      ) : null}
      <label className="ep-field" htmlFor={`${id}-file`}>
        <span className="ep-field__label">
          Choose file <span aria-hidden="true">*</span>
        </span>
        <input
          id={`${id}-file`}
          type="file"
          className="ep-input"
          required
          aria-describedby={`${id}-file-help`}
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          onChange={(e) => read(e.target.files?.[0])}
        />
        <span id={`${id}-file-help`} className="ep-field__help">
          The template’s headers (or the old module’s): .xlsx or .csv.
        </span>
      </label>
      <div className="ep-bulk__row">
        <button
          type="button"
          className="ep-btn ep-btn--primary ep-btn--sm"
          disabled={!ready || pending}
          onClick={() => go(true)}
        >
          {pending ? 'Checking…' : 'Preview & Validate (dry run)'}
        </button>
        {ok && good && !ok.saved ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending}
            onClick={() => go(false)}
          >
            Save {good} row{good === 1 ? '' : 's'}
          </button>
        ) : null}
        {days && !ready && file ? (
          <span className="ep-field__help" style={{ margin: 0 }}>
            Give the Default Reason first.
          </span>
        ) : null}
      </div>
      {result && !result.ok ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          <span>{result.error}</span>
        </p>
      ) : null}
      {ok ? (
        <>
          <p
            className={`ep-alert ${ok.saved ? 'ep-alert--success' : 'ep-alert--info'}`}
            role="status"
          >
            <span>
              {ok.saved
                ? `${String(ok.saved)} saved.`
                : `${String(good)} ready to save · ${String(skipped)} skipped (leave on the day) · ${String(bad)} with a problem — out of ${String(ok.rows.length)} rows.`}
            </span>
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Rows checked">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Date</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {ok.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.employee}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.day}</td>
                    <td>
                      {r.ok ? (
                        <span className="ep-stage ep-stage--ok">Good</span>
                      ) : r.error?.startsWith('skipped') ? (
                        <span className="ep-stage ep-stage--l1">{r.error}</span>
                      ) : (
                        <span style={{ color: 'var(--status-danger-text)' }}>{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The days set on screen: the employees picked (searchable) or a department, the dates, a status. */
function OnScreen({
  employees,
  departments,
  back,
  today,
  from,
  to,
  bulk,
}: {
  employees: Array<{ id: string; name: string; code: string; department: string | null }>;
  departments: string[];
  back: string;
  today: string;
  from: string;
  to: string;
  bulk: (fd: FormData) => Promise<void>;
}) {
  const [who, setWho] = useState<'employees' | 'department'>('employees');
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [type, setType] = useState('P');
  const shown = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f
      ? employees.filter((e) =>
          `${e.code} ${e.name} ${e.department ?? ''}`.toLowerCase().includes(f),
        )
      : employees;
  }, [employees, find]);
  const shownIds = useMemo(() => new Set(shown.map((e) => e.id)), [shown]);
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const end = to < today ? to : today;
  return (
    <form action={bulk} className="ep-bulk">
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="who" value={who} />
      <p className="ep-note">
        <strong>One status for many staff over a few days</strong> (at most 62). Each day is set by
        hand (Manual) with the reason. A day under a full day’s leave is left as it is; days to come
        and locked months are refused.
      </p>
      <fieldset className="ep-bulk__who">
        <legend className="ep-field__label">Who</legend>
        <label className="ep-check" htmlFor="bk-who-e">
          <input
            id="bk-who-e"
            type="radio"
            name="who-pick"
            checked={who === 'employees'}
            onChange={() => setWho('employees')}
          />
          <span>The employees I pick</span>
        </label>
        <label className="ep-check" htmlFor="bk-who-d">
          <input
            id="bk-who-d"
            type="radio"
            name="who-pick"
            checked={who === 'department'}
            onChange={() => setWho('department')}
          />
          <span>Everyone in a department</span>
        </label>
      </fieldset>
      {who === 'employees' ? (
        <div className="ep-picker">
          <div className="ep-picker__bar">
            <label className="ep-sr-only" htmlFor="bk-find">
              Find employees
            </label>
            <input
              id="bk-find"
              type="search"
              className="ep-input"
              placeholder="Find by code, name or department"
              value={find}
              onChange={(e) => setFind(e.target.value)}
            />
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setPicked((p) => new Set([...p, ...shown.map((e) => e.id)]))}
            >
              Pick all shown
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setPicked(new Set())}
            >
              Clear
            </button>
            <span className="ep-field__help" style={{ margin: 0 }} aria-live="polite">
              {picked.size} picked
            </span>
          </div>
          <ul className="ep-picker__list" aria-label="Employees">
            {employees.map((e) => (
              <li key={e.id} hidden={!shownIds.has(e.id)}>
                <label className="ep-check" htmlFor={`bk-e-${e.id}`}>
                  <input
                    id={`bk-e-${e.id}`}
                    type="checkbox"
                    name="employeeIds"
                    value={e.id}
                    checked={picked.has(e.id)}
                    onChange={(x) => toggle(e.id, x.target.checked)}
                  />
                  <span>
                    <strong>{e.code}</strong> {e.name}
                    {e.department ? <span className="ep-mr-col__desc">{e.department}</span> : null}
                  </span>
                </label>
              </li>
            ))}
            {shown.length ? null : <li className="ep-field__help">Nobody matches.</li>}
          </ul>
        </div>
      ) : (
        <label className="ep-field" htmlFor="bk-dept">
          <span className="ep-field__label">
            Department <span aria-hidden="true">*</span>
          </span>
          <select id="bk-dept" name="department" className="ep-select" required defaultValue="">
            <option value="">Pick a department</option>
            {departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ep-bulk__grid">
        <label className="ep-field" htmlFor="bk-from">
          <span className="ep-field__label">From Date</span>
          <input
            id="bk-from"
            name="from"
            type="date"
            className="ep-input"
            defaultValue={from}
            max={today}
            required
          />
        </label>
        <label className="ep-field" htmlFor="bk-to">
          <span className="ep-field__label">To Date</span>
          <input
            id="bk-to"
            name="to"
            type="date"
            className="ep-input"
            defaultValue={end}
            max={today}
            required
          />
        </label>
        <label className="ep-field" htmlFor="bk-type">
          <span className="ep-field__label">Status</span>
          <select
            id="bk-type"
            name="dayType"
            className="ep-select"
            data-native
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {STATUSES.map(([k, w]) => (
              <option key={k} value={k}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="ep-field" htmlFor="bk-why">
        <span className="ep-field__label">
          Reason <span aria-hidden="true">*</span>
        </span>
        <input
          id="bk-why"
          name="reason"
          className="ep-input"
          minLength={3}
          maxLength={300}
          required
          placeholder="e.g. Training day at school"
        />
      </label>
      {type === 'A' ? (
        <label className="ep-check ep-note ep-note--warn" htmlFor="bk-off">
          <input id="bk-off" type="checkbox" name="confirmOff" value="1" />
          <span>
            A weekly off or holiday in these days becomes absent too (loss of pay once the month is
            locked). Without this tick such days stop the update.
          </span>
        </label>
      ) : null}
      <div className="ep-bulk__row">
        <button
          type="submit"
          className="ep-btn ep-btn--primary ep-btn--sm"
          disabled={who === 'employees' && picked.size === 0}
        >
          Set the days{who === 'employees' && picked.size ? ` for ${String(picked.size)}` : ''}
        </button>
      </div>
    </form>
  );
}
