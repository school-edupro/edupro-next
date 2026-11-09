import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { LEAVE_STATUS, dmy, type LeaveStatus, type MyAttendance } from '@/lib/leave';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * My attendance (docs/design/85, phase C): a month of my days — what each was, IN, OUT, hours, late or
 * early — the totals, and the corrections I asked; a day opens its detail, where I ask for a correction.
 */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : '';
  const d = await apiFetch<MyAttendance>(`/staff-attendance/mine${month ? `?month=${month}` : ''}`);
  const m = d.month.slice(0, 7);
  const count = (codes: string[]) => d.days.filter((x) => codes.includes(x.dayType)).length;
  return (
    <>
      <Breadcrumbs items={[{ label: 'My leave', href: '/leave' }, { label: 'My attendance' }]} />
      <PageHeader
        kicker="Leave & attendance"
        title={`My attendance${d.monthWords ? ` · ${d.monthWords}` : ''}`}
        description="Your days as the biometric punches made them. A day is wrong — you forgot to punch, or the device missed you? Open it and ask for a correction; your approver decides."
      />
      <Notice params={sp} />
      {!d.employee ? (
        <p className="ep-alert ep-alert--info" role="status">
          Your sign-in is not linked to an employee record, so there is no attendance to show.
        </p>
      ) : (
        <>
          {d.locked ? (
            <p className="ep-alert ep-alert--info" role="status">
              This month is locked for payroll: corrections can no longer be asked.
            </p>
          ) : null}
          <div className="ep-dash-kpis">
            <KpiTile label="Present" value={String(count(['P']))} />
            <KpiTile label="Half days" value={String(count(['HD']))} />
            <KpiTile label="Absent" value={String(count(['A']))} />
            <KpiTile label="On leave" value={String(count(['LV']))} />
            <KpiTile label="Late" value={String(d.days.filter((x) => x.late > 0).length)} />
            <KpiTile label="Weekly offs and holidays" value={String(count(['WO', 'H']))} />
          </div>
          <form method="get" action="/leave/attendance/mine" className="ep-grid__toolbar">
            <label className="ep-field" htmlFor="am-month">
              <span className="ep-field__label">Month</span>
              <input
                id="am-month"
                name="month"
                type="month"
                className="ep-input"
                defaultValue={m}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
          </form>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="My days">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">What</th>
                  <th scope="col">IN</th>
                  <th scope="col">OUT</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Hours
                  </th>
                  <th scope="col">Late or early</th>
                </tr>
              </thead>
              <tbody>
                {d.days.length ? (
                  d.days.map((x) => (
                    <tr key={x.day}>
                      <td>
                        <a href={`/leave/attendance/day?emp=${d.employee!.id}&day=${x.day}`}>
                          {dmy(x.day)}
                        </a>
                        <span className="ep-mr-col__desc">
                          {WEEKDAY[new Date(`${x.day}T00:00:00Z`).getUTCDay()]}
                        </span>
                      </td>
                      <td>
                        <strong>{x.code}</strong> {x.words}
                        {x.manual ? <span className="ep-mr-col__desc">set by hand</span> : null}
                        {x.remark ? <span className="ep-mr-col__desc">{x.remark}</span> : null}
                      </td>
                      <td>{x.in ?? '—'}</td>
                      <td>{x.out ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{x.worked ?? '—'}</td>
                      <td>
                        {[
                          x.late ? `late ${String(x.late)} min` : null,
                          x.early ? `left ${String(x.early)} min early` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No days recorded in this month yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <section
            className="ep-card"
            aria-labelledby="am-regs"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h2 id="am-regs" className="ep-card__title">
              Corrections I asked
            </h2>
            {d.regularisations.length ? (
              <ul className="ep-list">
                {d.regularisations.map((g) => (
                  <li key={g.id}>
                    <a href={`/leave/attendance/day?emp=${d.employee!.id}&day=${g.day}`}>
                      {dmy(g.day)}
                    </a>{' '}
                    ·{' '}
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
                    {g.waiting ? <span className="ep-mr-col__desc">With {g.waiting}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help">None in this month.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
