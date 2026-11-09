import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { LEAVE_STATUS, dmy, type AttendanceDay, type LeaveStatus } from '@/lib/leave';
import {
  askRegularisation,
  correctDay,
  decideRegularisation,
  withdrawRegularisation,
} from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE: Record<string, string> = {
  device: 'Device',
  central: 'Device database',
  import: 'Excel',
  manual: 'By hand',
};
const MARK: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> =
  {
    pending: { label: 'Counts this month', tone: 'warning' },
    used: { label: 'Charged as leave', tone: 'danger' },
    waived: { label: 'Waived', tone: 'neutral' },
    retired: { label: 'Cleared', tone: 'neutral' },
    lapsed: { label: 'Lapsed', tone: 'neutral' },
  };
const at = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/**
 * A day of an employee's attendance (docs/design/85, phase C): what it is and how it was worked out, the
 * punches, the late mark or missing punch, the leave on it, the corrections asked and its history; the office
 * corrects it here, the employee asks for a correction.
 */
export default async function AttendanceDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const emp = sp.emp ?? '';
  const day = sp.day ?? '';
  if (!ID.test(emp) || !DAY.test(day)) notFound();
  const me = await getMe();
  let d: AttendanceDay;
  try {
    d = await apiFetch<AttendanceDay>(`/staff-attendance/days/${emp}/${day}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const office = me.permissions.includes('leave.office.manage');
  const here = `/leave/attendance/day?emp=${emp}&day=${day}`;
  const r = d.row;
  const live = d.regularisations.find((g) => g.status === 'pending');
  return (
    <>
      <Breadcrumbs
        items={
          !office && !d.can.mine
            ? [
                { label: 'My leave', href: '/leave' },
                {
                  label: 'Attendance corrections waiting for me',
                  href: '/leave/attendance/approvals',
                },
                { label: dmy(day) },
              ]
            : office
              ? [
                  { label: 'Employee management', href: '/people/employees' },
                  {
                    label: 'Attendance register',
                    href: `/leave/attendance?month=${day.slice(0, 7)}`,
                  },
                  { label: dmy(day) },
                ]
              : [
                  {
                    label: 'My attendance',
                    href: `/leave/attendance/mine?month=${day.slice(0, 7)}`,
                  },
                  { label: dmy(day) },
                ]
        }
      />
      <PageHeader
        kicker={`${d.employee.name} · ${d.employee.code}${d.employee.department ? ` · ${d.employee.department}` : ''}`}
        title={`${dmy(day)} · ${r ? r.words : 'Not marked yet'}`}
        description={
          r
            ? r.how
            : 'Nothing is recorded for this day yet: the punches are read every 15 minutes and the day is worked out then, or at night.'
        }
      />
      <Notice params={sp} />
      {d.locked ? (
        <p className="ep-alert ep-alert--info" role="status">
          This month is locked for payroll: the day cannot change until the office unlocks it.
        </p>
      ) : null}
      <div className="ep-dash-kpis">
        {(
          [
            ['Day', r ? r.words : '—'],
            ['IN', r?.in ?? '—'],
            ['OUT', r?.out ?? '—'],
            ['Hours worked', r?.worked != null ? String(r.worked) : '—'],
            ['Late by', r && r.late ? `${String(r.late)} min` : '—'],
            ['Left early by', r && r.early ? `${String(r.early)} min` : '—'],
          ] as const
        ).map(([k, v]) => (
          <KpiTile key={k} label={k} value={v} />
        ))}
      </div>
      {r ? (
        <p className="ep-field__help">
          {r.manual ? (
            <Badge tone="info">Set by hand — the punches no longer change it</Badge>
          ) : null}{' '}
          {r.leave ? <Badge tone="neutral">Leave: {r.leave}</Badge> : null}{' '}
          {r.overtime ? `Overtime ${String(r.overtime)} h. ` : ''}
          {r.remark ? `Remark: ${r.remark}` : ''}
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="ad-punch" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ad-punch" className="ep-card__title">
          Punches
        </h2>
        {d.punches.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ad-punch">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">From</th>
                  <th scope="col">Device</th>
                </tr>
              </thead>
              <tbody>
                {d.punches.map((p) => (
                  <tr key={p.at}>
                    <td>{dmy(p.date)}</td>
                    <td>{p.time}</td>
                    <td>{SOURCE[p.source] ?? p.source}</td>
                    <td>{p.device || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No punches read for this day.</p>
        )}
      </section>
      {d.marks.length ? (
        <section
          className="ep-card"
          aria-labelledby="ad-marks"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="ad-marks" className="ep-card__title">
            Late mark and missing punch
          </h2>
          <ul className="ep-list">
            {d.marks.map((m) => (
              <li key={m.kind}>
                {m.detail}{' '}
                <Badge tone={MARK[m.status]?.tone ?? 'neutral'}>
                  {MARK[m.status]?.label ?? m.status}
                </Badge>
                {m.reason ? ` — ${m.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {d.can.decide && live ? (
        <section
          className="ep-card"
          aria-labelledby="ad-decide"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="ad-decide" className="ep-card__title">
            A correction waits for you
          </h2>
          <p>
            {[
              live.in_time ? `IN ${live.in_time}` : null,
              live.out_time ? `OUT ${live.out_time}` : null,
              live.day_type,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            — {live.reason}
          </p>
          <form
            action={decideRegularisation.bind(null, d.can.decide)}
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <input type="hidden" name="back" value={here} />
            <label className="ep-field" htmlFor="ad-note">
              <span className="ep-field__label">Remark (needed to not approve)</span>
              <input id="ad-note" name="note" className="ep-input" maxLength={500} />
            </label>
            <button
              type="submit"
              name="outcome"
              value="approved"
              className="ep-btn ep-btn--primary ep-btn--sm"
            >
              Approve
            </button>
            <button
              type="submit"
              name="outcome"
              value="rejected"
              className="ep-btn ep-btn--secondary ep-btn--sm"
            >
              Not approve
            </button>
          </form>
        </section>
      ) : null}
      {d.can.correct ? (
        <FoldCard
          id="ad-correct"
          title="Correct the day"
          hint="Set the times or what the day was; it is kept in the history"
          open={!!sp.correct}
        >
          <form action={correctDay} className="ep-form-section__body">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="employeeId" value={emp} />
            <input type="hidden" name="day" value={day} />
            <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
              <label className="ep-field" htmlFor="ad-in">
                <span className="ep-field__label">IN</span>
                <input
                  id="ad-in"
                  name="in"
                  type="time"
                  className="ep-input"
                  defaultValue={r?.in ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ad-out">
                <span className="ep-field__label">OUT</span>
                <input
                  id="ad-out"
                  name="out"
                  type="time"
                  className="ep-input"
                  defaultValue={r?.out ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ad-type">
                <span className="ep-field__label">The day is</span>
                <select id="ad-type" name="dayType" className="ep-select" defaultValue="">
                  <option value="">Worked out from the times</option>
                  <option value="P">Present</option>
                  <option value="HD">Half day</option>
                  <option value="A">Absent</option>
                  <option value="WO">Weekly off</option>
                  <option value="H">Holiday</option>
                  <option value="HOLD">Salary hold</option>
                </select>
              </label>
            </div>
            <label className="ep-field" htmlFor="ad-why">
              <span className="ep-field__label">Why</span>
              <input
                id="ad-why"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={300}
              />
            </label>
            <p className="ep-field__help">
              An OUT earlier than the IN is the next morning. The late mark or missing punch the
              correction settles is cleared. Leave on the day is changed from the leave request, not
              here.
            </p>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Save the correction
            </button>
          </form>
        </FoldCard>
      ) : null}
      {d.can.regularise ? (
        <FoldCard
          id="ad-reg"
          title="Ask for a correction"
          hint="Forgot to punch, or the device missed you? Your approver decides"
          open={!!sp.ask}
        >
          <form action={askRegularisation} className="ep-form-section__body">
            <input type="hidden" name="back" value={here} />
            <input type="hidden" name="day" value={day} />
            <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
              <label className="ep-field" htmlFor="ar-in">
                <span className="ep-field__label">IN</span>
                <input
                  id="ar-in"
                  name="in"
                  type="time"
                  className="ep-input"
                  defaultValue={r?.in ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ar-out">
                <span className="ep-field__label">OUT</span>
                <input
                  id="ar-out"
                  name="out"
                  type="time"
                  className="ep-input"
                  defaultValue={r?.out ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ar-type">
                <span className="ep-field__label">The day was</span>
                <select id="ar-type" name="dayType" className="ep-select" defaultValue="">
                  <option value="">Worked out from the times</option>
                  <option value="P">Present</option>
                  <option value="HD">Half day</option>
                  <option value="WO">Weekly off</option>
                  <option value="H">Holiday</option>
                </select>
              </label>
            </div>
            <label className="ep-field" htmlFor="ar-why">
              <span className="ep-field__label">Reason</span>
              <input
                id="ar-why"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={500}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Send to my approver
            </button>
          </form>
        </FoldCard>
      ) : null}
      {d.leave.length ? (
        <FoldCard
          id="ad-leave"
          title="Leave on this day"
          hint={d.leave.map((l) => `${l.number} ${l.code}`).join(', ')}
        >
          <ul className="ep-list">
            {d.leave.map((l) => (
              <li key={l.id}>
                <a href={`/leave/requests/${l.id}`}>{l.number}</a> · {l.code} ·{' '}
                {l.portion < 1 ? 'half a day' : 'a day'}{' '}
                <Badge tone={LEAVE_STATUS[l.status as LeaveStatus]?.tone ?? 'neutral'}>
                  {LEAVE_STATUS[l.status as LeaveStatus]?.label ?? l.status}
                </Badge>
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
      {d.regularisations.length ? (
        <FoldCard
          id="ad-regs"
          title="Corrections asked"
          hint={
            live ? 'One is waiting for the approver' : `${String(d.regularisations.length)} asked`
          }
          open={!!live}
        >
          <ul className="ep-list">
            {d.regularisations.map((g) => (
              <li key={g.id}>
                {[
                  g.in_time ? `IN ${g.in_time}` : null,
                  g.out_time ? `OUT ${g.out_time}` : null,
                  g.day_type,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                — {g.reason}{' '}
                <Badge tone={LEAVE_STATUS[g.status as LeaveStatus]?.tone ?? 'neutral'}>
                  {LEAVE_STATUS[g.status as LeaveStatus]?.label ?? g.status}
                </Badge>
                {g.status === 'pending' && d.can.mine ? (
                  <form
                    action={withdrawRegularisation.bind(null, g.id)}
                    style={{ display: 'inline', marginLeft: 'var(--sp-2)' }}
                  >
                    <input type="hidden" name="back" value={here} />
                    <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                      Withdraw
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
      <FoldCard
        id="ad-hist"
        title="History"
        hint={
          d.history.length
            ? `${String(d.history.length)} change${d.history.length === 1 ? '' : 's'}`
            : 'No changes'
        }
      >
        {d.history.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ad-hist">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Why</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.at + h.to}>
                    <td>{at(h.at)}</td>
                    <td>{h.from}</td>
                    <td>{h.to}</td>
                    <td>{h.reason ?? '—'}</td>
                    <td>{h.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">The day has not changed since it was first worked out.</p>
        )}
      </FoldCard>
    </>
  );
}
