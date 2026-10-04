import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { apiFetch, getMe } from '@/lib/api';
import {
  STATE_LABEL,
  STATE_TONE,
  addDays,
  dayLabel,
  dayOf,
  studentLabel,
  timeOf,
  today,
  type AppointmentState,
} from '@/lib/appointments';

interface Visit {
  id: string;
  number: string;
  state: AppointmentState;
  startsAt: string;
  place: string | null;
  hostName: string | null;
  purpose: string;
  visitorName: string | null;
  visitorOrg: string | null;
  partySize: number;
  student: string | null;
  section: string | null;
  admissionNo: string | null;
}
interface WithMe {
  data: Visit[];
  page: { number: number; size: number; total: number };
  counts: { today: number; upcoming: number; past: number };
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WHEN = ['today', 'upcoming', 'past', 'all'] as const;
type When = (typeof WHEN)[number];
const PAGE_SIZE = 25;
/** The Monday of the week a day falls in. */
const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const whoLine = (v: Visit) =>
  `${v.visitorName ?? 'Visitor'}${v.partySize > 1 ? ` + ${String(v.partySize - 1)}` : ''}`;

/**
 * My appointments: who comes to meet me (the principal, a teacher, a desk's person in charge), as a list
 * (today, still to come, past, with search and dates) or as a week calendar. Only what the front desk has
 * confirmed shows here; the front desk confirms, moves and cancels, and keeps the visitor's contact details.
 */
export default async function MyAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    when?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
    day?: string;
  }>;
}) {
  const sp = await searchParams;
  const calendar = sp.view === 'calendar';
  const when: When = WHEN.includes(sp.when as When) ? (sp.when as When) : 'upcoming';
  const from = DATE.test(sp.from ?? '') ? sp.from! : '';
  const to = DATE.test(sp.to ?? '') ? sp.to! : '';
  const q = sp.q?.trim().slice(0, 80) ?? '';
  const page = Math.max(1, Number(sp.page) || 1);
  const day = DATE.test(sp.day ?? '') ? sp.day! : today();
  const weekFrom = monday(day);
  const weekTo = addDays(weekFrom, 6);
  const query: Record<string, string> = calendar
    ? { from: weekFrom, to: weekTo, when: 'all', size: '200' }
    : {
        when,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(q ? { q } : {}),
        page: String(page),
        size: String(PAGE_SIZE),
      };
  const [me, list] = await Promise.all([
    getMe(),
    apiFetch<WithMe>(`/appointments/with-me?${new URLSearchParams(query).toString()}`),
  ]);
  const listHref = (over: Record<string, string>) =>
    `?${new URLSearchParams({
      when,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(q ? { q } : {}),
      ...over,
    }).toString()}`;
  const weekHref = (d: string) => `?view=calendar&day=${d}`;
  const days = [...new Set(list.data.map((v) => dayOf(v.startsAt)))];
  const pages = Math.ceil(list.page.total / PAGE_SIZE);
  const TABS: Array<[When, string]> = [
    ['today', `Today · ${String(list.counts.today)}`],
    ['upcoming', `Still to come · ${String(list.counts.upcoming)}`],
    ['past', `Past · ${String(list.counts.past)}`],
    ['all', 'Everything'],
  ];
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="My appointments"
        description="Appointments with you that the front desk has confirmed. The front desk confirms and moves them."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
              href="?"
              aria-current={calendar ? undefined : 'page'}
            >
              List
            </a>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
              href={weekHref(day)}
              aria-current={calendar ? 'page' : undefined}
            >
              Calendar
            </a>
          </span>
        }
      />
      <AppointmentNav current="/engagement/appointments/mine" permissions={me.permissions} />
      {calendar ? (
        <>
          <div className="ep-filter-band">
            <form method="get" className="ep-dlog__filters">
              <input type="hidden" name="view" value="calendar" />
              <label className="ep-field" htmlFor="mc-day">
                <span className="ep-field__label">Week of</span>
                <input id="mc-day" name="day" type="date" className="ep-input" defaultValue={day} />
              </label>
              <Button type="submit">Show</Button>
              <a className="ep-btn ep-btn--secondary" href={weekHref(addDays(day, -7))}>
                ← Earlier
              </a>
              <a className="ep-btn ep-btn--secondary" href={weekHref(today())}>
                This week
              </a>
              <a className="ep-btn ep-btn--secondary" href={weekHref(addDays(day, 7))}>
                Later →
              </a>
            </form>
          </div>
          <p className="ep-field__help">
            {dayLabel(weekFrom)} to {dayLabel(weekTo)} · {String(list.data.length)}{' '}
            {list.data.length === 1 ? 'appointment' : 'appointments'}
          </p>
          <div className="ep-cal ep-cal--week">
            {Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)).map((d) => {
              const rows = list.data.filter((v) => dayOf(v.startsAt) === d);
              return (
                <Card
                  key={d}
                  className={d === today() ? 'ep-cal__day ep-cal__day--today' : 'ep-cal__day'}
                >
                  <h2 className="ep-cal__head">
                    <span>{dayLabel(d)}</span>
                    <span className="ep-field__help">{String(rows.length)}</span>
                  </h2>
                  {rows.length ? (
                    <ul className="ep-cal__list">
                      {rows.map((v) => (
                        <li key={v.id}>
                          <div className="ep-cal__item" data-state={v.state}>
                            <strong>{timeOf(v.startsAt)}</strong> {whoLine(v)}
                            <span className="ep-cal__meta">
                              {[
                                studentLabel(v),
                                v.purpose,
                                v.place ?? v.hostName,
                                STATE_LABEL[v.state],
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ep-field__help">Nothing booked</p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
            {TABS.map(([k, label]) => (
              <a key={k} href={`?when=${k}`} aria-current={k === when ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="ep-filter-band">
            <form method="get" className="ep-dlog__filters">
              <input type="hidden" name="when" value={when} />
              <label className="ep-field" htmlFor="mf-from">
                <span className="ep-field__label">From</span>
                <input
                  id="mf-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={from}
                />
              </label>
              <label className="ep-field" htmlFor="mf-to">
                <span className="ep-field__label">To</span>
                <input id="mf-to" name="to" type="date" className="ep-input" defaultValue={to} />
              </label>
              <InputField
                id="mf-q"
                name="q"
                type="search"
                label="Number, visitor, student, admission no. or purpose"
                defaultValue={q}
                maxLength={80}
              />
              <Button type="submit">Show</Button>
              {from || to || q ? (
                <a className="ep-btn ep-btn--secondary" href={`?when=${when}`}>
                  Clear
                </a>
              ) : null}
            </form>
          </div>
          {list.data.length === 0 ? (
            <Card>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {from || to || q
                  ? 'Nothing matches these filters.'
                  : when === 'past'
                    ? 'No past appointments with you.'
                    : 'Nobody has a confirmed appointment with you here.'}
              </p>
            </Card>
          ) : null}
          {days.map((d) => (
            <Card key={d} title={dayLabel(d)} style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={dayLabel(d)}>
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Appointments with me on {dayLabel(d)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Visitor</th>
                      <th scope="col">Student</th>
                      <th scope="col">Purpose</th>
                      <th scope="col">Where</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data
                      .filter((v) => dayOf(v.startsAt) === d)
                      .map((v) => (
                        <tr key={v.id}>
                          <td>{timeOf(v.startsAt)}</td>
                          <td>
                            {whoLine(v)}
                            <div className="ep-field__help">
                              {[v.number, v.visitorOrg].filter(Boolean).join(' · ')}
                            </div>
                          </td>
                          <td>
                            {v.student ?? '—'}
                            {v.student ? (
                              <div className="ep-field__help">
                                {[v.section, v.admissionNo ? `Adm. no. ${v.admissionNo}` : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            ) : null}
                          </td>
                          <td>{v.purpose}</td>
                          <td>{v.place ?? v.hostName ?? '—'}</td>
                          <td>
                            <Badge tone={STATE_TONE[v.state]}>{STATE_LABEL[v.state]}</Badge>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          {pages > 1 ? (
            <nav
              aria-label="Pages"
              style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}
            >
              {page > 1 ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={listHref({ page: String(page - 1) })}
                >
                  ← Previous
                </a>
              ) : null}
              <span className="ep-field__help">
                Page {page} of {pages} · {String(list.page.total)} in all
              </span>
              {page < pages ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={listHref({ page: String(page + 1) })}
                >
                  Next →
                </a>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
