import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { markBusAttendance } from './actions';

interface MyRoute {
  routeId: string;
  code: string;
  name: string;
  trip: 'pick' | 'drop';
  tripLabel: string;
}
interface Hint {
  leave: { number: string; from: string; to: string } | null;
  pass: { kind: 'early_leave' | 'late_arrival'; number: string; atTime: string | null } | null;
}
interface Rider {
  studentId: string;
  name: string;
  admissionNo: string | null;
  section: string | null;
  stop: string | null;
  atTime: string | null;
  code: string | null;
  remarks: string | null;
  hint: Hint | null;
  classCode: string | null;
  tapped: string | null;
  suggested: string | null;
  locked?: boolean;
}
interface Roll {
  id: string | null;
  route: string;
  vehicle: string | null;
  date: string;
  trip: 'pick' | 'drop';
  tripLabel: string;
  markedBy: string | null;
  markedLate: boolean;
  window: {
    open: boolean;
    late: boolean;
    from: string | null;
    to: string | null;
    note: string | null;
  };
  roster: Rider[];
  counts: Record<string, number>;
}

const CODES: Array<[string, string]> = [
  ['P', 'On the bus'],
  ['A', 'Not on the bus'],
  ['LV', 'On leave'],
  ['GP', 'Gate pass'],
  ['OT', 'Other arrangement'],
];
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
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Bus attendance: the teacher mapped to a route marks the morning (pick) and the afternoon (drop) trip.
 * The list is the route's approved riders; an approved leave or a gate pass of the day is filled in
 * already and can be changed; the school's marking window applies.
 */
export default async function BusAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{
    pick?: string;
    date?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  let routes: MyRoute[];
  try {
    routes = (await bff.api.fetch<{ data: MyRoute[] }>('/attendance/bus-roll/routes')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Bus attendance" />
          <Card>Bus attendance is not part of your role.</Card>
        </main>
      );
    throw error;
  }
  const chosen = routes.find((r) => `${r.routeId}|${r.trip}` === sp.pick) ?? routes[0] ?? null;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  let roll: Roll | null = null;
  let loadError: string | null = null;
  if (chosen) {
    try {
      roll = await bff.api.fetch<Roll>(
        `/attendance/bus-roll?routeId=${chosen.routeId}&date=${date}&trip=${chosen.trip}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = error.problem.detail ?? error.problem.type;
      else throw error;
    }
  }
  const month = date.slice(0, 7);
  const closed = roll ? !roll.window.open : false;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Bus attendance"
        title={chosen ? `${chosen.code} · ${chosen.tripLabel}` : 'Bus attendance'}
        description={
          roll?.id
            ? `${String(roll.counts.P ?? 0)} on the bus · ${String(roll.counts.A ?? 0)} not on the bus · ${String(roll.counts.LV ?? 0)} leave · ${String(roll.counts.GP ?? 0)} gate pass · marked by ${roll.markedBy ?? '—'}${roll.markedLate ? ' (late)' : ''}`
            : roll
              ? 'Not marked yet for this trip.'
              : ''
        }
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/bus-attendance/register${chosen ? `?route=${chosen.routeId}` : ''}`}
            >
              Monthly register
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              Home
            </a>
          </>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Bus attendance saved.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {routes.length === 0 ? (
        <Card>
          No route is mapped to you for bus attendance. The coordinator maps a teacher to each route
          for the morning and the afternoon trip under Attendance → Set-up.
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-3)' }}>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <label className="ep-field" style={{ minWidth: 260 }}>
              <span className="ep-field__label">Route and trip</span>
              <select
                className="ep-select"
                name="pick"
                defaultValue={chosen ? `${chosen.routeId}|${chosen.trip}` : ''}
              >
                {routes.map((r) => (
                  <option key={`${r.routeId}|${r.trip}`} value={`${r.routeId}|${r.trip}`}>
                    {r.code} · {r.name} · {r.tripLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Date</span>
              <input
                className="ep-input"
                type="date"
                name="date"
                defaultValue={date}
                max={today()}
              />
            </label>
            <Button type="submit" variant="secondary">
              Open the list
            </Button>
          </form>
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
            P on the bus · A not on the bus · LV on leave · GP gate pass (left early or comes late)
            · OT other arrangement (a parent brings or collects).
          </p>
          {chosen ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              Register of {month}:{' '}
              <a
                href={`/api/register?route=${chosen.routeId}&trip=both&month=${month}&format=xlsx`}
                style={{ textDecoration: 'underline' }}
              >
                Excel
              </a>{' '}
              ·{' '}
              <a
                href={`/api/register?route=${chosen.routeId}&trip=both&month=${month}&format=pdf`}
                style={{ textDecoration: 'underline' }}
              >
                PDF
              </a>
            </p>
          ) : null}
        </Card>
      )}
      {loadError ? <Card>{loadError}</Card> : null}
      {roll && chosen ? (
        <Card
          title={`${roll.route} · ${roll.date}${roll.vehicle ? ` · ${roll.vehicle}` : ''}`}
          actions={<Badge tone="neutral">{roll.roster.length} riders</Badge>}
        >
          {roll.window.note ? (
            <div
              className={`ep-alert ${closed ? 'ep-alert--warning' : 'ep-alert--info'}`}
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {roll.window.note}
            </div>
          ) : roll.window.from || roll.window.to ? (
            <p className="ep-field__help">
              Marking is open {roll.window.from ?? 'from the start of the day'} –{' '}
              {roll.window.to ?? 'the end of the day'}.
            </p>
          ) : null}
          {roll.roster.length === 0 ? (
            <p className="ep-field__help">No pupil rides this route on this trip.</p>
          ) : (
            <form action={markBusAttendance}>
              <input type="hidden" name="routeId" value={chosen.routeId} />
              <input type="hidden" name="trip" value={chosen.trip} />
              <input type="hidden" name="date" value={roll.date} />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Riders">
                <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
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
                      <tr
                        key={r.studentId}
                        className={
                          r.hint?.pass
                            ? 'ep-row--pass'
                            : r.hint?.leave
                              ? 'ep-row--leave'
                              : undefined
                        }
                      >
                        <th scope="row">
                          {r.name}
                          <div className="ep-kicker">
                            {[r.section, r.admissionNo].filter(Boolean).join(' · ')}
                          </div>
                          {r.hint?.leave ? (
                            <Badge tone="info">
                              {r.locked
                                ? 'On leave (approved): cannot be changed'
                                : 'On leave (approved)'}
                            </Badge>
                          ) : null}{' '}
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
                            style={{
                              border: 0,
                              padding: 0,
                              margin: 0,
                              display: 'flex',
                              gap: 'var(--sp-2)',
                              flexWrap: 'wrap',
                            }}
                          >
                            <legend className="ep-sr-only">Mark for {r.name}</legend>
                            {CODES.map(([code, label]) => (
                              <label
                                key={code}
                                title={label}
                                style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                              >
                                <input
                                  type="radio"
                                  name={`code-${r.studentId}`}
                                  value={code}
                                  defaultChecked={
                                    (r.locked ? 'LV' : (r.code ?? r.suggested ?? 'P')) === code
                                  }
                                  disabled={closed || (r.locked === true && code !== 'LV')}
                                />
                                {code}
                              </label>
                            ))}
                          </fieldset>
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name={`remarks-${r.studentId}`}
                            aria-label={`Remarks · ${r.name}`}
                            defaultValue={r.remarks ?? ''}
                            maxLength={200}
                            disabled={closed}
                            style={{ minWidth: 120 }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!closed ? (
                <div
                  style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
                >
                  <Button type="submit">
                    {roll.id ? 'Update bus attendance' : 'Save bus attendance'}
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </Card>
      ) : null}
    </main>
  );
}
