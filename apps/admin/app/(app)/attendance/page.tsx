import { Badge, Button, Card, DataTable, InputField, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { apiFetch, getMe } from '@/lib/api';
import {
  shortDay,
  windowText,
  type AttendanceDashboard,
  type TripTotals,
} from '@/lib/attendance-plus';
import type { AttendanceSummary, AttendanceSummaryRow } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** S9-06: the day's attendance across the sections the viewer may see. */
export default async function AttendanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, summary, me, d] = await Promise.all([
    getTranslations('pages.attendance_dashboard'),
    getTranslations('attendance'),
    apiFetch<AttendanceSummary>(`/attendance/summary?date=${date}`),
    getMe(),
    apiFetch<AttendanceDashboard>(`/attendance/desk/dashboard?date=${date}`),
  ]);
  const busMax = Math.max(1, ...d.trend.map((x) => Math.max(x.pick, x.drop)));
  const trips: Array<['pick' | 'drop', string, TripTotals, string]> = [
    [
      'pick',
      'Bus · morning (pick)',
      d.bus.pick,
      windowText(d.windows.busPickFrom, d.windows.busPickTo),
    ],
    [
      'drop',
      'Bus · afternoon (drop)',
      d.bus.drop,
      windowText(d.windows.busDropFrom, d.windows.busDropTo),
    ],
  ];
  const rows = summary.sections;
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Attendance dashboard"
        description="Class and bus attendance of the day: who is in, who is on leave, what is not marked yet, and the last 14 days."
      />
      <AttendanceNav current="/attendance" permissions={me.permissions} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
        <Button type="submit" variant="secondary">
          {a('show')}
        </Button>
      </form>
      <div className="ep-cdash__kpis">
        {(
          [
            [
              'In school',
              d.class.percent === null ? '—' : `${String(d.class.percent)}%`,
              `${String(d.class.present)} present of ${String(d.class.present + d.class.absent + d.class.leave)} marked`,
            ],
            ['Absent', String(d.class.absent), `${String(d.class.late)} came late`],
            [
              'On leave',
              String(d.class.leave),
              `${String(d.known.leave)} approved leave(s) cover this day`,
            ],
            [
              'Gate passes',
              String(d.known.earlyLeave + d.known.lateArrival),
              `${String(d.known.earlyLeave)} leaving early · ${String(d.known.lateArrival)} coming late`,
            ],
            [
              'Classes marked',
              `${String(d.class.markedSections)} / ${String(d.class.sections)}`,
              `${String(d.class.unmarked)} pupil(s) not marked · window ${windowText(d.windows.classFrom, d.windows.classTo)}`,
            ],
            ['Marked late', String(d.class.markedLate), 'class registers saved outside the window'],
          ] as Array<[string, string, string]>
        ).map(([title, value, help]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <span className="ep-cdash__num">{value}</span>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <div className="ep-cdash__two">
        {trips.map(([trip, title, x, win]) => (
          <Card
            key={trip}
            title={title}
            actions={
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/attendance/bus-roll?date=${date}`}
              >
                Route-wise
              </a>
            }
          >
            <dl className="ep-sheet__grid">
              {(
                [
                  ['Riders', x.riders],
                  ['On the bus', x.present],
                  ['Not on the bus', x.absent],
                  ['On leave', x.leave],
                  ['Gate pass', x.gatePass],
                  ['Other arrangement', x.other],
                  ['Not marked', x.unmarked],
                  ['Routes marked', `${String(x.markedRoutes)} / ${String(x.routes)}`],
                ] as Array<[string, string | number]>
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="ep-field__help">Marking window: {win}.</p>
          </Card>
        ))}
        <Card title={`Classes not marked · ${String(d.class.pending.length)}`}>
          {d.class.pending.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Every class is marked.
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.class.pending.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/attendance/register?classSectionId=${p.id}&date=${date}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {p.name}
                  </a>
                  <span className="ep-field__help">
                    {' '}
                    · {p.teacher ?? 'no class teacher mapped'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Bus trips not marked · ${String(d.bus.pending.length)}`}>
          {d.bus.pending.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Every route with riders is marked for both trips.
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.bus.pending.map((p) => (
                <li key={`${p.routeId}-${p.trip}`}>
                  <a
                    href={`/attendance/bus-roll?date=${date}&route=${p.routeId}&trip=${p.trip}`}
                    style={{ textDecoration: 'underline' }}
                  >
                    {p.code} · {p.trip === 'pick' ? 'morning' : 'afternoon'}
                  </a>
                  <span className="ep-field__help"> · {p.teachers ?? 'no teacher mapped'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Last 14 days" style={{ margin: 'var(--sp-4) 0' }}>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Last 14 days">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Class and bus attendance, day by day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">In school</th>
                <th scope="col" className="ep-num">
                  Present
                </th>
                <th scope="col">Bus morning</th>
                <th scope="col">Bus afternoon</th>
              </tr>
            </thead>
            <tbody>
              {[...d.trend].reverse().map((x) => (
                <tr key={x.date}>
                  <th scope="row">
                    <a href={`/attendance?date=${x.date}`} style={{ textDecoration: 'underline' }}>
                      {shortDay(x.date)}
                    </a>
                  </th>
                  <td>
                    {x.percent === null ? (
                      <span className="ep-field__help">not marked</span>
                    ) : (
                      <>
                        {x.percent}%
                        <div className="ep-clinic__bar" aria-hidden="true">
                          <span style={{ width: `${String(Math.max(2, x.percent))}%` }} />
                        </div>
                      </>
                    )}
                  </td>
                  <td className="ep-num">{x.present || ''}</td>
                  {([x.pick, x.drop] as number[]).map((n, i) => (
                    <td key={String(i)}>
                      {n ? (
                        <>
                          {n}
                          <div className="ep-clinic__bar" aria-hidden="true">
                            <span
                              style={{ width: `${String(Math.max(2, (100 * n) / busMax))}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="ep-field__help">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <h2 className="ep-cdash__h3">Class by class</h2>
      <Card>
        <DataTable<AttendanceSummaryRow>
          caption={`${a('date')} ${date}`}
          density="dense"
          columns={[
            {
              key: 'section',
              header: a('section'),
              render: (r) => (
                <a href={`/attendance/register?classSectionId=${r.classSectionId}&date=${date}`}>
                  <strong>{r.section}</strong>
                </a>
              ),
            },
            { key: 'strength', header: a('strength'), numeric: true, render: (r) => r.strength },
            {
              key: 'present',
              header: a('present'),
              numeric: true,
              render: (r) => (r.sessionId ? r.present : ''),
            },
            {
              key: 'absent',
              header: a('absent'),
              numeric: true,
              render: (r) => (r.sessionId ? r.absent : ''),
            },
            {
              key: 'leave',
              header: 'Leave',
              numeric: true,
              render: (r) => (r.sessionId ? (r.leave ?? 0) : ''),
            },
            {
              key: 'late',
              header: a('late'),
              numeric: true,
              render: (r) => (r.sessionId ? r.late : ''),
            },
            {
              key: 'status',
              header: a('markedBy'),
              render: (r) =>
                r.sessionId ? (
                  <span
                    style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                  >
                    {r.markedBy ?? a(`sources.${r.source ?? 'manual'}`)}
                    {r.source === 'rfid' ? <Badge tone="info">{a('sources.rfid')}</Badge> : null}
                    {r.locked ? <Badge tone="warning">{a('locked')}</Badge> : null}
                  </span>
                ) : (
                  <Badge tone="neutral">{a('notMarked')}</Badge>
                ),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.classSectionId}
          emptyTitle={a('notMarked')}
        />
      </Card>
    </>
  );
}
