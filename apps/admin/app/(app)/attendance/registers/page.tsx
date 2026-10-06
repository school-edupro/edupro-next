import { Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { BusRegisterTable, type BusRegister } from '@/components/attendance/BusRegisterTable';
import { apiFetch, getMe } from '@/lib/api';
import { istToday } from '@/lib/attendance-plus';
import { sectionOptions } from '@/lib/sections';

interface ClassRegister {
  section: string;
  month: string;
  days: string[];
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string | null;
    rollNo: number | null;
    marks: Record<string, string>;
    present: number;
    absent: number;
    leave: number;
    late: number;
    percent: number | null;
  }>;
}
/**
 * The monthly registers: a class (a row per pupil, a column per day, present / absent / leave / late and
 * the percentage) or a bus route and trip (on the bus / not on the bus / leave / gate pass), on screen
 * and as Excel or PDF.
 */
export default async function AttendanceRegistersPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    section?: string;
    route?: string;
    trip?: string;
    month?: string;
  }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === 'bus' ? 'bus' : 'class';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : istToday().slice(0, 7);
  const trip = sp.trip === 'drop' || sp.trip === 'pick' ? sp.trip : 'both';
  const [me, sections, routes] = await Promise.all([
    getMe(),
    sectionOptions(),
    apiFetch<{ data: Array<{ id: string; code: string; name: string }> }>('/transport/routes')
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const section = sections.find((s) => s.value === sp.section)?.value ?? null;
  const route = routes.find((r) => r.id === sp.route)?.id ?? null;
  const [cls, bus] = await Promise.all([
    kind === 'class' && section
      ? apiFetch<ClassRegister>(
          `/attendance/desk/class-register?classSectionId=${section}&month=${month}`,
        ).catch(() => null)
      : Promise.resolve(null),
    kind === 'bus' && route
      ? apiFetch<BusRegister>(
          `/attendance/bus-roll/register?routeId=${route}&trip=${trip}&month=${month}`,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);
  const file = (format: string) =>
    kind === 'class'
      ? `/api/attendance/register?section=${section ?? ''}&month=${month}&format=${format}`
      : `/api/attendance/register?route=${route ?? ''}&trip=${trip}&month=${month}&format=${format}`;
  const reg = cls ?? bus;
  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Monthly registers"
        description="The attendance register of a class or of a bus route for a month, with totals; download it as Excel or PDF."
        actions={
          reg ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
                Excel
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
                PDF
              </a>
            </span>
          ) : null
        }
      />
      <AttendanceNav current="/attendance/registers" permissions={me.permissions} />
      <nav className="ep-tabs-links" aria-label="Register" style={{ marginBottom: 'var(--sp-3)' }}>
        <a
          href={`/attendance/registers?kind=class&month=${month}`}
          aria-current={kind === 'class' ? 'page' : undefined}
        >
          Class register
        </a>
        <a
          href={`/attendance/registers?kind=bus&month=${month}`}
          aria-current={kind === 'bus' ? 'page' : undefined}
        >
          Bus register
        </a>
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="kind" value={kind} />
          {kind === 'class' ? (
            <SelectField
              id="rg-section"
              name="section"
              label="Class"
              defaultValue={section ?? ''}
              options={[{ value: '', label: 'Choose the class' }, ...sections]}
            />
          ) : (
            <>
              <SelectField
                id="rg-route"
                name="route"
                label="Route"
                defaultValue={route ?? ''}
                options={[
                  { value: '', label: 'Choose the route' },
                  ...routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
                ]}
              />
              <SelectField
                id="rg-trip"
                name="trip"
                label="Trip"
                defaultValue={trip}
                options={[
                  { value: 'both', label: 'Morning and afternoon' },
                  { value: 'pick', label: 'Morning (pick) only' },
                  { value: 'drop', label: 'Afternoon (drop) only' },
                ]}
              />
            </>
          )}
          <label className="ep-field" htmlFor="rg-month">
            <span className="ep-field__label">Month</span>
            <input
              id="rg-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={month}
            />
          </label>
          <Button type="submit">Show</Button>
        </form>
      </div>
      {!reg ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {kind === 'class'
              ? 'Choose a class and a month.'
              : 'Choose a route, a trip and a month.'}
          </p>
        </Card>
      ) : (
        <Card
          title={
            cls
              ? `Class ${cls.section} · ${month} · ${String(cls.days.length)} day(s) marked`
              : `${bus!.route} · ${bus!.tripLabel} · ${month} · ${String(bus!.days.length)} day(s) marked`
          }
        >
          {reg.rows.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No pupil on this list.
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Register">
              {cls ? (
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Attendance register of {month}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      {cls.days.map((d) => (
                        <th key={d} scope="col" className="ep-num" title={d}>
                          {d.slice(8)}
                        </th>
                      ))}
                      {['Present', 'Absent', 'Leave', 'Late', '%'].map((h) => (
                        <th key={h} scope="col" className="ep-num">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cls.rows.map((r) => (
                      <tr key={r.studentId}>
                        <th scope="row">
                          {r.rollNo ? `${String(r.rollNo)}. ` : ''}
                          {r.name}
                          <div className="ep-field__help">{r.admissionNo}</div>
                        </th>
                        {cls.days.map((d) => (
                          <td key={d} className="ep-num">
                            {r.marks[d] ?? '–'}
                          </td>
                        ))}
                        <td className="ep-num">{r.present}</td>
                        <td className="ep-num">{r.absent}</td>
                        <td className="ep-num">{r.leave}</td>
                        <td className="ep-num">{r.late}</td>
                        <td className="ep-num">{r.percent ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <BusRegisterTable reg={bus!} />
              )}
            </div>
          )}
          <p className="ep-field__help">
            {cls
              ? 'P present · A absent · LV leave · L late · H half day · SR short leave · OD on duty · SB stay back · – not marked'
              : 'M morning (pick) · A afternoon (drop) · P on the bus · A not on the bus · LV leave · GP gate pass · OT other arrangement · – not marked · blank: does not ride that trip'}
          </p>
        </Card>
      )}
    </>
  );
}
