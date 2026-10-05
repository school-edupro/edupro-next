import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { markBusRoll } from '@/lib/attendance-actions';
import {
  BUS_CODES,
  istToday,
  windowText,
  type BusRoll,
  type BusSummaryRow,
  type Windows,
} from '@/lib/attendance-plus';
import { when } from '@/lib/appointments';

const CLASS_CODE: Record<string, string> = {
  P: 'present in class',
  A: 'absent in class',
  L: 'late in class',
  LV: 'on leave',
  SR: 'short leave',
  H: 'half day',
  OD: 'on duty',
  SB: 'stay back',
};

/**
 * Bus attendance route by route: for a date, every route's morning and afternoon trip with its riders,
 * how many are on the bus, not on it, on leave, on a gate pass, and what is not marked; open a trip to
 * see or mark its list (the teacher mapped to the route marks it in the teacher app).
 */
export default async function BusRollPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    route?: string;
    trip?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : istToday();
  const trip = sp.trip === 'drop' ? 'drop' : 'pick';
  const routeId = /^\d+$/.test(sp.route ?? '') ? sp.route! : null;
  const me = await getMe();
  const canMark = me.permissions.includes('attendance.bus.mark');
  const [summary, roll] = await Promise.all([
    apiFetch<{ date: string; windows: Windows; rows: BusSummaryRow[] }>(
      `/attendance/bus-roll/summary?date=${date}`,
    ).catch(() => null),
    routeId
      ? apiFetch<BusRoll>(
          `/attendance/bus-roll?routeId=${routeId}&date=${date}&trip=${trip}`,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);
  const month = date.slice(0, 7);
  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Bus attendance"
        description="Marked by the teacher mapped to each route, for the morning and the afternoon trip. Approved leave and gate passes of the day are filled in already."
      />
      <AttendanceNav current="/attendance/bus-roll" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <form method="get" className="ep-dlog__filters" style={{ marginBottom: 'var(--sp-4)' }}>
        <label className="ep-field" htmlFor="br-date">
          <span className="ep-field__label">Date</span>
          <input
            id="br-date"
            name="date"
            type="date"
            className="ep-input"
            defaultValue={date}
            max={istToday()}
          />
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {summary === null ? (
        <Alert tone="warning">
          The route-wise summary is for staff who oversee attendance. Mark your own route in the
          teacher app under Bus attendance.
        </Alert>
      ) : (
        <Card title={`Route-wise · ${date}`} style={{ marginBottom: 'var(--sp-4)' }}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Marking windows: morning{' '}
            {windowText(summary.windows.busPickFrom, summary.windows.busPickTo)} · afternoon{' '}
            {windowText(summary.windows.busDropFrom, summary.windows.busDropTo)}.
          </p>
          {summary.rows.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No route is set up yet.
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Routes">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Bus attendance of {date}, route by route</caption>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Trip</th>
                    <th scope="col" className="ep-num">
                      Riders
                    </th>
                    <th scope="col" className="ep-num">
                      On bus
                    </th>
                    <th scope="col" className="ep-num">
                      Not on bus
                    </th>
                    <th scope="col" className="ep-num">
                      Leave
                    </th>
                    <th scope="col" className="ep-num">
                      Gate pass
                    </th>
                    <th scope="col" className="ep-num">
                      Other
                    </th>
                    <th scope="col" className="ep-num">
                      Not marked
                    </th>
                    <th scope="col">Marked by</th>
                    <th scope="col">
                      <span className="ep-sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={`${r.routeId}-${r.trip}`}>
                      <th scope="row">
                        {r.code}
                        <div className="ep-field__help">{r.name}</div>
                      </th>
                      <td>{r.trip === 'pick' ? 'Morning' : 'Afternoon'}</td>
                      <td className="ep-num">{r.riders}</td>
                      <td className="ep-num">{r.marked ? r.present : ''}</td>
                      <td className="ep-num">{r.marked ? r.absent : ''}</td>
                      <td className="ep-num">{r.marked ? r.leave : ''}</td>
                      <td className="ep-num">{r.marked ? r.gatePass : ''}</td>
                      <td className="ep-num">{r.marked ? r.other : ''}</td>
                      <td className="ep-num">{r.unmarked || ''}</td>
                      <td>
                        {r.marked ? (
                          <>
                            {r.markedBy ?? '—'}{' '}
                            {r.markedLate ? <Badge tone="warning">Late</Badge> : null}
                            {r.markedAt ? (
                              <div className="ep-field__help">{when(r.markedAt)}</div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Badge tone="neutral">Not marked</Badge>
                            <div className="ep-field__help">
                              {r.teachers ?? 'no teacher mapped'}
                            </div>
                          </>
                        )}
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/attendance/bus-roll?date=${date}&route=${r.routeId}&trip=${r.trip}#list`}
                          aria-label={`Open ${r.code}, ${r.trip === 'pick' ? 'morning' : 'afternoon'}`}
                        >
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {roll ? (
        <Card
          title={`${roll.route} · ${roll.tripLabel} · ${roll.date}${roll.vehicle ? ` · ${roll.vehicle}` : ''}`}
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/attendance/register?route=${roll.routeId}&trip=${roll.trip}&month=${month}&format=xlsx`}
              >
                Register (Excel)
              </a>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/attendance/register?route=${roll.routeId}&trip=${roll.trip}&month=${month}&format=pdf`}
              >
                Register (PDF)
              </a>
            </span>
          }
        >
          <span id="list" />
          {roll.window.note ? (
            <p className="ep-field__help" role="status">
              {roll.window.note}
            </p>
          ) : null}
          {roll.roster.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No pupil rides this route on this trip.
            </p>
          ) : (
            <form action={markBusRoll}>
              <input type="hidden" name="routeId" value={roll.routeId} />
              <input type="hidden" name="trip" value={roll.trip} />
              <input type="hidden" name="date" value={roll.date} />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Riders">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">
                    Riders of {roll.route}, {roll.tripLabel}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Stoppage</th>
                      <th scope="col">Mark</th>
                      <th scope="col">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roll.roster.map((r) => (
                      <tr key={r.studentId}>
                        <th scope="row">
                          {r.name}
                          <div className="ep-field__help">
                            {[r.section, r.admissionNo ? `Adm. no. ${r.admissionNo}` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                          {r.hint?.leave ? <Badge tone="info">Leave approved</Badge> : null}{' '}
                          {r.hint?.pass ? (
                            <Badge tone="warning">
                              {r.hint.pass.kind === 'early_leave'
                                ? 'Gate pass: leaves early'
                                : 'Gate pass: comes late'}
                              {r.hint.pass.atTime ? ` ${r.hint.pass.atTime}` : ''}
                            </Badge>
                          ) : null}
                          {r.classCode || r.tapped ? (
                            <div className="ep-field__help">
                              {[
                                r.classCode ? (CLASS_CODE[r.classCode] ?? r.classCode) : null,
                                r.tapped ? `card read ${r.tapped}` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          ) : null}
                        </th>
                        <td>
                          {r.stop ?? '—'}
                          {r.atTime ? <div className="ep-field__help">{r.atTime}</div> : null}
                        </td>
                        <td>
                          <fieldset
                            className="ep-slots"
                            style={{ border: 0, padding: 0, margin: 0 }}
                          >
                            <legend className="ep-sr-only">Mark for {r.name}</legend>
                            <span
                              style={{
                                display: 'inline-flex',
                                gap: 'var(--sp-2)',
                                flexWrap: 'wrap',
                              }}
                            >
                              {BUS_CODES.map(([code, label]) => (
                                <label key={code} title={label}>
                                  <input
                                    type="radio"
                                    name={`code-${r.studentId}`}
                                    value={code}
                                    defaultChecked={(r.code ?? r.suggested ?? 'P') === code}
                                    disabled={!canMark}
                                  />{' '}
                                  {code}
                                </label>
                              ))}
                            </span>
                          </fieldset>
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name={`remarks-${r.studentId}`}
                            aria-label={`Remarks for ${r.name}`}
                            defaultValue={r.remarks ?? ''}
                            maxLength={200}
                            disabled={!canMark}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ep-field__help">
                {BUS_CODES.map(([c, l]) => `${c} ${l.toLowerCase()}`).join(' · ')}
              </p>
              {canMark ? (
                <div>
                  <Button type="submit">
                    {roll.id ? 'Update bus attendance' : 'Save bus attendance'}
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </Card>
      ) : routeId ? (
        <Alert tone="warning">
          This route’s list is for its mapped teacher and staff who oversee attendance.
        </Alert>
      ) : null}
    </>
  );
}
