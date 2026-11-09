import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { AttendanceSheetImport } from '@/components/leave/AttendanceSheetImport';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { AttendanceRegister } from '@/lib/leave';
import { lockMonth, runAttendance } from '@/lib/leave-actions';

const TONE: Record<string, string> = {
  P: 'var(--status-success-text)',
  HD: 'var(--status-warning-text)',
  A: 'var(--status-danger-text)',
  LOP: 'var(--status-danger-text)',
  HOLD: 'var(--status-danger-text)',
  WO: 'var(--text-muted)',
  H: 'var(--text-muted)',
};
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * The attendance register (docs/design/85, phase C): a month of every employee — each day's code with
 * late, missing-punch and set-by-hand marks, the totals and payable days — a day opens its detail; the
 * payroll lock; run the jobs now; days and punches from Excel; the payroll feed.
 */
export default async function AttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.office.manage')) notFound();
  const size = pageSizeOf(sp.size ?? '25');
  const keep = new URLSearchParams();
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) keep.set('month', sp.month);
  if (sp.department) keep.set('department', sp.department.slice(0, 100));
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  const qs = new URLSearchParams(keep);
  qs.set('size', size);
  qs.set('page', String(Math.max(1, Number(sp.page) || 1)));
  let d: AttendanceRegister;
  try {
    d = await apiFetch<AttendanceRegister>(`/staff-attendance/register?${qs.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const link = (page: number) => {
    const p = new URLSearchParams(keep);
    p.set('size', size);
    if (page > 1) p.set('page', String(page));
    return `/leave/attendance?${p.toString()}`;
  };
  const here = link(d.page);
  const month = d.month.slice(0, 7);
  const locked = !!d.lock?.locked;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Attendance register' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title={`Attendance register · ${d.monthWords}`}
        description="Every employee's days, worked out from the biometric punches: P present, HD half day, A absent, WO weekly off, H holiday, the leave's code (½ for half a day), LOP loss of pay. A dot after the code: late (L), a punch missing (M), set by hand (✎). Click a day to see how it was worked out, its punches and history, and to correct it."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/leave/attendance/exceptions?month=${month}`}
            >
              Late marks and missing punches
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/leave/attendance-file?month=${month}${sp.department ? `&department=${encodeURIComponent(sp.department)}` : ''}`}
            >
              Payroll feed (Excel)
            </a>
          </div>
        }
      />
      <Notice params={sp} />
      <p className={locked ? 'ep-alert ep-alert--info' : 'ep-field__help'} role="status">
        {locked
          ? `${d.monthWords} is locked for payroll${d.lock?.by ? ` by ${d.lock.by}` : ''}: nothing in it changes until it is unlocked.`
          : d.mayLock
            ? `${d.monthWords} is open. Lock it once payroll is final: the absent days nobody explained become loss of pay first.`
            : `${d.monthWords} is still running.`}
        {d.lock && !d.lock.locked && d.lock.unlockReason
          ? ` Unlocked before: ${d.lock.unlockReason}.`
          : ''}
      </p>
      <form
        method="get"
        action="/leave/attendance"
        className="ep-grid__toolbar"
        style={{ flexWrap: 'wrap' }}
      >
        <label className="ep-field" htmlFor="ar-month">
          <span className="ep-field__label">Month</span>
          <input
            id="ar-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={month}
          />
        </label>
        <label className="ep-field" htmlFor="ar-dept">
          <span className="ep-field__label">Department</span>
          <select
            id="ar-dept"
            name="department"
            className="ep-select"
            defaultValue={sp.department ?? ''}
          >
            <option value="">All departments</option>
            {d.departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="ar-q">
          <span className="ep-field__label">Search</span>
          <input
            id="ar-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Name or code"
          />
        </label>
        <PerPage id="ar-size" value={size} />
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Attendance register">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {d.dates.map((x) => (
                <th key={x} scope="col" style={{ textAlign: 'center', padding: 'var(--sp-1)' }}>
                  {Number(x.slice(8, 10))}
                  <span className="ep-mr-col__desc">
                    {WEEKDAY[new Date(`${x}T00:00:00Z`).getUTCDay()]}
                  </span>
                </th>
              ))}
              {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'HOLD', 'Late', 'Miss', 'Pay'].map((h) => (
                <th key={h} scope="col" style={{ textAlign: 'right' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.employee.id}>
                  <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                    {r.employee.name}
                    <span className="ep-mr-col__desc">{r.employee.code}</span>
                  </th>
                  {r.cells.map((c) => (
                    <td
                      key={c.day}
                      style={{ textAlign: 'center', padding: 'var(--sp-1)' }}
                      title={c.title || undefined}
                    >
                      {c.code ? (
                        <a
                          href={`/leave/attendance/day?emp=${r.employee.id}&day=${c.day}`}
                          style={{
                            color: TONE[c.code.replace('½', '')] ?? 'var(--text-primary)',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                          aria-label={`${r.employee.name} ${c.day}: ${c.title || c.code}`}
                        >
                          {c.code}
                          {c.late ? <sup>L</sup> : null}
                          {c.missing ? <sup>M</sup> : null}
                          {c.manual ? <sup>✎</sup> : null}
                        </a>
                      ) : null}
                    </td>
                  ))}
                  {['P', 'HD', 'A', 'WO', 'H', ...d.types, 'HOLD', 'late', 'missing'].map((k) => (
                    <td key={k} style={{ textAlign: 'right' }}>
                      {r.totals[k] ?? 0}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    <strong>{r.payable}</strong>
                    {r.unmarked ? (
                      <span className="ep-mr-col__desc" style={{ whiteSpace: 'nowrap' }}>
                        {r.unmarked} not marked
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={d.dates.length + 10 + d.types.length}>No staff in these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={d.page} size={d.size} total={d.total} href={link} noun="employees" />
      <div className="ep-setup-sections" style={{ marginTop: 'var(--sp-4)' }}>
        <section className="ep-card" aria-labelledby="ar-lock">
          <h2 id="ar-lock" className="ep-card__title">
            Payroll lock
          </h2>
          {locked ? (
            <form action={lockMonth.bind(null, false)} className="ep-form-section__body">
              <input type="hidden" name="back" value={here} />
              <input type="hidden" name="month" value={month} />
              <label className="ep-field" htmlFor="ar-why">
                <span className="ep-field__label">Why unlock</span>
                <input
                  id="ar-why"
                  name="reason"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Unlock {d.monthWords}
              </button>
            </form>
          ) : d.mayLock ? (
            <form action={lockMonth.bind(null, true)}>
              <input type="hidden" name="back" value={here} />
              <input type="hidden" name="month" value={month} />
              <p className="ep-field__help">
                Locking turns the absent days with no leave and no correction asked into loss of
                pay, then stops every change in the month (leave, corrections, punches).
              </p>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Lock {d.monthWords}
              </button>
            </form>
          ) : (
            <p className="ep-field__help">A month is locked once it is over.</p>
          )}
        </section>
        <section className="ep-card" aria-labelledby="ar-run">
          <h2 id="ar-run" className="ep-card__title">
            Run now
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The system reads punches every 15 minutes and does the rest every night. Run a step now
            after a change.
          </p>
          {(
            [
              ['sync', 'Read the new punches'],
              [
                'nightly',
                'The nightly run (weekly offs, holidays, absent, late marks, missing punches, loss of pay)',
              ],
            ] as const
          ).map(([what, label]) => (
            <form key={what} action={runAttendance} style={{ marginBottom: 'var(--sp-2)' }}>
              <input type="hidden" name="back" value={here} />
              <input type="hidden" name="what" value={what} />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {label}
              </button>
            </form>
          ))}
          <form action={runAttendance} className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="what" value="recompute" />
            <label className="ep-field" htmlFor="ar-rf">
              <span className="ep-field__label">From</span>
              <input id="ar-rf" name="from" type="date" className="ep-input" />
            </label>
            <label className="ep-field" htmlFor="ar-rt">
              <span className="ep-field__label">To</span>
              <input id="ar-rt" name="to" type="date" className="ep-input" />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Work these days out again
            </button>
          </form>
          <form action={runAttendance} className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="what" value="deduct" />
            <label className="ep-field" htmlFor="ar-dm">
              <span className="ep-field__label">Month</span>
              <input id="ar-dm" name="month" type="month" className="ep-input" />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Deduct its late marks and missing punches
            </button>
          </form>
        </section>
      </div>
      <section className="ep-card" aria-labelledby="ar-up" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ar-up" className="ep-card__title">
          From Excel
        </h2>
        <h3 className="ep-field__label">Days set by hand (the punches no longer change them)</h3>
        <AttendanceSheetImport what="days" />
        <h3 className="ep-field__label" style={{ marginTop: 'var(--sp-4)' }}>
          Punches the device could not send
        </h3>
        <AttendanceSheetImport what="punches" />
      </section>
      <p className="ep-field__help">
        <Badge tone="neutral">Legend</Badge> P present · HD half day · A absent · WO weekly off · H
        holiday · CL, EL… leave (½ half a day) · LOP loss of pay · HOLD salary hold · L late · M
        punch missing · ✎ set by hand · · not marked
      </p>
    </>
  );
}
