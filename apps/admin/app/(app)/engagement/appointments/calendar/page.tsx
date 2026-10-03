import { Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { apiFetch, getMe } from '@/lib/api';
import {
  STATE_LABEL,
  addDays,
  dayLabel,
  dayOf,
  timeOf,
  today,
  whoOf,
  type Appointment,
  type BookableHost,
} from '@/lib/appointments';

interface Calendar {
  data: Appointment[];
  hosts: BookableHost[];
  closed: Array<{ d: string; name: string }>;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The Monday of the week a day falls in. */
const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The appointment calendar: a week (Monday to Sunday) or one day, for everyone or one person or desk, or
 * only the appointments with me. Each entry carries its status colour and opens the appointment.
 */
export default async function AppointmentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; view?: string; hostId?: string; mine?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'day' ? 'day' : 'week';
  const day = DATE.test(sp.day ?? '') ? sp.day! : today();
  const from = view === 'day' ? day : monday(day);
  const to = view === 'day' ? day : addDays(from, 6);
  const hostId = /^\d{1,18}$/.test(sp.hostId ?? '') ? sp.hostId! : '';
  const mine = sp.mine === 'true';
  const [me, cal] = await Promise.all([
    getMe(),
    apiFetch<Calendar>(
      `/appointments/calendar?${new URLSearchParams({
        from,
        to,
        ...(hostId ? { hostId } : {}),
        ...(mine ? { mine: 'true' } : {}),
      }).toString()}`,
    ),
  ]);
  const days = Array.from({ length: view === 'day' ? 1 : 7 }, (_, i) => addDays(from, i));
  const link = (d: string, v = view) =>
    `?${new URLSearchParams({
      day: d,
      view: v,
      ...(hostId ? { hostId } : {}),
      ...(mine ? { mine: 'true' } : {}),
    }).toString()}`;
  const step = view === 'day' ? 1 : 7;
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="Calendar"
        description={`${dayLabel(from)}${view === 'week' ? ` to ${dayLabel(to)}` : ''} · ${String(cal.data.length)} ${cal.data.length === 1 ? 'appointment' : 'appointments'}. Declined and cancelled ones are not shown.`}
      />
      <AppointmentNav current="/engagement/appointments/calendar" permissions={me.permissions} />
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="cal-day">
            <span className="ep-field__label">Day</span>
            <input id="cal-day" name="day" type="date" className="ep-input" defaultValue={day} />
          </label>
          <SelectField
            id="cal-view"
            name="view"
            label="Show"
            defaultValue={view}
            options={[
              { value: 'week', label: 'The week' },
              { value: 'day', label: 'One day' },
            ]}
          />
          <SelectField
            id="cal-host"
            name="hostId"
            label="To meet"
            defaultValue={hostId}
            options={[
              { value: '', label: 'Everyone' },
              ...cal.hosts.map((h) => ({ value: h.id, label: h.name })),
            ]}
          />
          <SelectField
            id="cal-mine"
            name="mine"
            label="Whose"
            defaultValue={mine ? 'true' : ''}
            options={[
              { value: '', label: 'All appointments' },
              { value: 'true', label: 'Only with me' },
            ]}
          />
          <Button type="submit">Show</Button>
          <a className="ep-btn ep-btn--secondary" href={link(addDays(day, -step))}>
            ← Earlier
          </a>
          <a className="ep-btn ep-btn--secondary" href={link(today())}>
            Today
          </a>
          <a className="ep-btn ep-btn--secondary" href={link(addDays(day, step))}>
            Later →
          </a>
        </form>
      </div>
      <div className={`ep-cal ep-cal--${view}`}>
        {days.map((d) => {
          const rows = cal.data.filter((a) => a.startsAt && dayOf(a.startsAt) === d);
          const closed = cal.closed.find((c) => c.d === d);
          return (
            <Card
              key={d}
              className={d === today() ? 'ep-cal__day ep-cal__day--today' : 'ep-cal__day'}
            >
              <h2 className="ep-cal__head">
                <a href={link(d, 'day')}>{dayLabel(d)}</a>
                <span className="ep-field__help">
                  {closed ? closed.name : `${String(rows.length)}`}
                </span>
              </h2>
              {rows.length ? (
                <ul className="ep-cal__list">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <a
                        className="ep-cal__item"
                        data-state={a.state}
                        href={`/engagement/appointments/${a.id}`}
                      >
                        <strong>{timeOf(a.startsAt)}</strong> {whoOf(a)}
                        <span className="ep-cal__meta">
                          {[a.hostName, a.withName, STATE_LABEL[a.state]]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ep-field__help">{closed ? 'School closed' : 'Nothing booked'}</p>
              )}
            </Card>
          );
        })}
      </div>
      <div className="ep-cdash__legend" style={{ marginTop: 'var(--sp-3)' }}>
        {(['requested', 'approved', 'checked_in', 'completed', 'no_show'] as const).map((s) => (
          <span key={s}>
            <i data-state={s} aria-hidden="true" /> {STATE_LABEL[s]}
          </span>
        ))}
      </div>
    </>
  );
}
