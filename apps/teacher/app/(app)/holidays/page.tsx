import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Holiday {
  id: string;
  name: string;
  kind: 'holiday' | 'vacation' | 'working_day';
  startsOn: string;
  endsOn: string;
  appliesTo: 'everyone' | 'students' | 'employees';
}
interface AlmanacEvent {
  id: string;
  title: string;
  kind: 'event' | 'exam' | 'meeting' | 'activity' | 'deadline';
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
  description: string | null;
  audience: 'everyone' | 'students' | 'employees';
}
interface Calendar {
  holidays: Holiday[];
  events: AlmanacEvent[];
  from: string;
  to: string;
}

const HOLIDAY_KIND: Record<Holiday['kind'], string> = {
  holiday: 'Holiday',
  vacation: 'Vacation',
  working_day: 'Working day',
};
const EVENT_KIND: Record<AlmanacEvent['kind'], string> = {
  event: 'Event',
  exam: 'Examination',
  meeting: 'Meeting',
  activity: 'Activity',
  deadline: 'Deadline',
};
const WHO: Record<Holiday['appliesTo'], string> = {
  everyone: 'For everyone',
  employees: 'For staff',
  students: 'Students and parents',
};
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Holidays and almanac for staff (docs/design/96, part 4): the session's holidays and the almanac — what is for
 * everyone and for staff — to read, as the admin app's Academics → Calendar shows them; every staff member, whatever
 * their role. Adding and removing stays in the admin app.
 */
export default async function HolidaysPage() {
  const lang = await currentLang();
  let cal: Calendar;
  try {
    cal = await bff.api.fetch<Calendar>('/academics/calendar/staff');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 409))
      return (
        <main>
          <PageHeader
            kicker={t(lang, 'Leave & attendance')}
            title={t(lang, 'Holidays and almanac')}
          />
          <Card>{t(lang, 'Nothing in this session yet.')}</Card>
        </main>
      );
    throw error;
  }
  const span = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);
  const today = istToday();
  // the next three days off or events from today
  const next = [
    ...cal.holidays
      .filter((h) => h.endsOn >= today)
      .map((h) => ({
        on: h.startsOn,
        key: `h${h.id}`,
        text: `${h.name} · ${t(lang, HOLIDAY_KIND[h.kind])}`,
        when: span(h.startsOn, h.endsOn),
      })),
    ...cal.events
      .filter((e) => e.endsOn >= today)
      .map((e) => ({
        on: e.startsOn,
        key: `e${e.id}`,
        text: `${e.title} · ${t(lang, EVENT_KIND[e.kind])}`,
        when: `${span(e.startsOn, e.endsOn)}${e.startsAt ? ` ${e.startsAt}` : ''}`,
      })),
  ]
    .sort((a, b) => a.on.localeCompare(b.on))
    .slice(0, 3);
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'Leave & attendance')}
        title={t(lang, 'Holidays and almanac')}
        description={`${t(lang, 'The session’s holidays and the almanac: exams, meetings, activities and events')} (${cal.from} → ${cal.to})`}
      />
      {next.length ? (
        <Card title={t(lang, 'Coming up')} style={{ marginBottom: 'var(--sp-4)' }}>
          <ul
            style={{ margin: 0, paddingLeft: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-1)' }}
          >
            {next.map((x) => (
              <li key={x.key}>
                <strong>{x.when}</strong> — {x.text}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="ep-setup-sections" style={{ marginTop: 0 }}>
        <Card title={t(lang, 'Holidays')}>
          <DataTable<Holiday>
            caption={t(lang, 'Holidays')}
            density="dense"
            columns={[
              { key: 'dates', header: t(lang, 'From'), render: (h) => span(h.startsOn, h.endsOn) },
              { key: 'name', header: t(lang, 'Name'), render: (h) => <strong>{h.name}</strong> },
              {
                key: 'kind',
                header: t(lang, 'What'),
                render: (h) => (
                  <Badge tone={h.kind === 'working_day' ? 'warning' : 'info'}>
                    {t(lang, HOLIDAY_KIND[h.kind])}
                  </Badge>
                ),
              },
              {
                key: 'who',
                header: t(lang, 'Applies to'),
                render: (h) => t(lang, WHO[h.appliesTo]),
              },
            ]}
            rows={cal.holidays}
            rowKey={(h) => h.id}
            emptyTitle={t(lang, 'Nothing in this session yet.')}
          />
        </Card>
        <Card title={t(lang, 'Almanac')}>
          <DataTable<AlmanacEvent>
            caption={t(lang, 'Almanac')}
            density="dense"
            columns={[
              {
                key: 'dates',
                header: t(lang, 'From'),
                render: (e) => `${span(e.startsOn, e.endsOn)}${e.startsAt ? ` ${e.startsAt}` : ''}`,
              },
              {
                key: 'title',
                header: t(lang, 'Title'),
                render: (e) => (
                  <>
                    <strong>{e.title}</strong>
                    {e.description ? (
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {e.description}
                      </span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'kind',
                header: t(lang, 'What'),
                render: (e) => (
                  <Badge
                    tone={
                      e.kind === 'exam' ? 'danger' : e.kind === 'deadline' ? 'warning' : 'neutral'
                    }
                  >
                    {t(lang, EVENT_KIND[e.kind])}
                  </Badge>
                ),
              },
              {
                key: 'who',
                header: t(lang, 'Applies to'),
                render: (e) => t(lang, WHO[e.audience]),
              },
            ]}
            rows={cal.events}
            rowKey={(e) => e.id}
            emptyTitle={t(lang, 'Nothing in this session yet.')}
          />
        </Card>
      </div>
    </main>
  );
}
