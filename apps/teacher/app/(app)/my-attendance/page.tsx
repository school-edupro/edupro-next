import { Badge, Card, PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { LEAVE_STATUS, dmy, type LeaveStatus, type MyAttendance } from '@/lib/leave';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  P: 'success',
  HD: 'warning',
  A: 'danger',
  HOLD: 'danger',
  WO: 'neutral',
  H: 'neutral',
  LV: 'info',
};

/**
 * My attendance in the staff app (docs/design/85, phase C): a month of my days from the biometric punches,
 * the totals and the corrections I asked; a day opens its detail, where I ask for a correction.
 */
export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; ok?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : '';
  const d = await bff.api.fetch<MyAttendance>(
    `/staff-attendance/mine${month ? `?month=${month}` : ''}`,
  );
  const count = (codes: string[]) => d.days.filter((x) => codes.includes(x.dayType)).length;
  return (
    <>
      <PageHeader
        kicker="Leave"
        title={`My attendance${d.monthWords ? ` · ${d.monthWords}` : ''}`}
        description="Your days as the biometric punches made them. A day is wrong — you forgot to punch, or the device missed you? Open it and ask for a correction."
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? 'Done.'}
        </p>
      ) : null}
      {!d.employee ? (
        <Card>
          <p>
            Your sign-in is not linked to an employee record, so there is no attendance to show.
          </p>
        </Card>
      ) : (
        <>
          {d.locked ? (
            <p className="ep-alert ep-alert--info" role="status">
              This month is locked for payroll: corrections can no longer be asked.
            </p>
          ) : null}
          <div className="ep-dash-kpis">
            {(
              [
                ['Present', count(['P'])],
                ['Half days', count(['HD'])],
                ['Absent', count(['A'])],
                ['On leave', count(['LV'])],
                ['Late', d.days.filter((x) => x.late > 0).length],
                ['Offs and holidays', count(['WO', 'H'])],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                <div style={{ fontSize: 'var(--fs-h3)', fontWeight: 600 }}>{v}</div>
                <div className="ep-field__label">{k}</div>
              </div>
            ))}
          </div>
          <form method="get" action="/my-attendance" className="ep-grid__toolbar">
            <label className="ep-field" htmlFor="ma-month">
              <span className="ep-field__label">Month</span>
              <input
                id="ma-month"
                name="month"
                type="month"
                className="ep-input"
                defaultValue={d.month.slice(0, 7)}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
          </form>
          <Card>
            <h2 className="ep-card__title">My days</h2>
            {d.days.length ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {d.days.map((x) => (
                  <li
                    key={x.day}
                    style={{
                      padding: 'var(--sp-2) 0',
                      borderBottom: '1px solid var(--border-default)',
                    }}
                  >
                    <a href={`/my-attendance/${x.day}`}>
                      <strong>
                        {WEEKDAY[new Date(`${x.day}T00:00:00Z`).getUTCDay()]} {dmy(x.day)}
                      </strong>
                    </a>{' '}
                    <Badge tone={TONE[x.dayType] ?? 'neutral'}>
                      {x.code} · {x.words}
                    </Badge>
                    <div className="ep-field__help" style={{ margin: 0 }}>
                      {[
                        x.in ? `IN ${x.in}` : null,
                        x.out ? `OUT ${x.out}` : null,
                        x.worked != null ? `${String(x.worked)} h` : null,
                        x.late ? `late ${String(x.late)} min` : null,
                        x.early ? `left ${String(x.early)} min early` : null,
                        x.manual ? 'set by hand' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No days recorded in this month yet.</p>
            )}
          </Card>
          <Card>
            <h2 className="ep-card__title">Corrections I asked</h2>
            {d.regularisations.length ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {d.regularisations.map((g) => (
                  <li
                    key={g.id}
                    style={{
                      padding: 'var(--sp-2) 0',
                      borderBottom: '1px solid var(--border-default)',
                    }}
                  >
                    <a href={`/my-attendance/${g.day}`}>{dmy(g.day)}</a>{' '}
                    <Badge tone={LEAVE_STATUS[g.status as LeaveStatus]?.tone ?? 'neutral'}>
                      {LEAVE_STATUS[g.status as LeaveStatus]?.label ?? g.status}
                    </Badge>
                    <div className="ep-field__help" style={{ margin: 0 }}>
                      {[
                        g.in_time ? `IN ${g.in_time}` : null,
                        g.out_time ? `OUT ${g.out_time}` : null,
                        g.day_type,
                        g.reason,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {g.waiting ? ` · with ${g.waiting}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>None in this month.</p>
            )}
          </Card>
        </>
      )}
    </>
  );
}
