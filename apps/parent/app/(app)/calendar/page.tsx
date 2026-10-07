import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';

interface Holiday {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
}
interface Event {
  id: string;
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
  description?: string | null;
}
interface Calendar {
  holidays: Holiday[];
  events: Event[];
  from: string;
  to: string;
}

type View = 'month' | 'holidays' | 'events';
/** What a day of the grid carries: a day off, a working day declared on a day off, or an event. */
type Mark = 'holiday' | 'vacation' | 'working_day' | 'exam' | 'event';
type Entry = {
  key: string;
  date: string;
  end: string;
  label: string;
  at: string | null;
  mark: Mark;
  note: string | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MARK_LABEL: Record<Mark, string> = {
  holiday: 'Holiday',
  vacation: 'Vacation',
  working_day: 'Working day',
  exam: 'Exam',
  event: 'Event',
};
/** When a day carries several things, the square takes the colour of the first of these. */
const MARK_ORDER: Mark[] = ['holiday', 'vacation', 'exam', 'working_day', 'event'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m - 1 + by, 1))).slice(0, 7);
};
const pretty = (s: string, withYear = false) =>
  utc(s).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
const daysOf = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000) + 1;
const span = (a: string, b: string) => (a === b ? pretty(a) : `${pretty(a)} – ${pretty(b)}`);

/** The month as a grid: every day is a link that lists what falls on it. */
function MonthGrid({
  lang,
  month,
  entries,
  today,
  picked,
}: {
  lang: Lang;
  month: string;
  entries: Entry[];
  today: string;
  picked: string | null;
}) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const on = (date: string) => entries.filter((e) => e.date <= date && e.end >= date);
  return (
    <table className="ep-hcal">
      <caption className="ep-sr-only">{t(lang, 'The month day by day')}</caption>
      <thead>
        <tr>
          {DAYS.map((d) => (
            <th key={d} scope="col">
              {t(lang, d)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, w) => (
          <tr key={String(w)}>
            {week.map((d, i) => {
              if (d === null) return <td key={String(i)} data-empty="" />;
              const date = `${month}-${String(d).padStart(2, '0')}`;
              const list = on(date);
              const mark = MARK_ORDER.find((k) => list.some((e) => e.mark === k));
              return (
                <td
                  key={String(i)}
                  data-mark={mark ?? (i === 6 ? 'sunday' : undefined)}
                  data-today={date === today ? '' : undefined}
                  data-picked={date === picked ? '' : undefined}
                >
                  <a
                    href={`/calendar?month=${month}&day=${date}#day`}
                    aria-current={date === picked ? 'date' : undefined}
                    aria-label={`${pretty(date)}${list.length ? `: ${list.map((e) => e.label).join(', ')}` : ''}`}
                  >
                    <span className="ep-hcal__no">{d}</span>
                    {list.slice(0, 2).map((e) => (
                      <span key={e.key} className="ep-hcal__what">
                        {e.label}
                      </span>
                    ))}
                    {list.length > 2 ? (
                      <span className="ep-hcal__what">+{list.length - 2}</span>
                    ) : null}
                  </a>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend({ lang }: { lang: Lang }) {
  return (
    <ul className="ep-hcal__legend" aria-label={t(lang, 'Colours')}>
      {MARK_ORDER.map((k) => (
        <li key={k}>
          <span data-mark={k} aria-hidden="true" />
          {t(lang, MARK_LABEL[k])}
        </li>
      ))}
    </ul>
  );
}

const tone = (e: Entry) =>
  e.mark === 'holiday' || e.mark === 'vacation'
    ? ('success' as const)
    : e.mark === 'exam'
      ? ('danger' as const)
      : e.mark === 'working_day'
        ? ('warning' as const)
        : ('neutral' as const);

/** Holidays and the almanac for families: a month grid, the holiday list of the session, and the events. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; day?: string }>;
}) {
  const lang = await currentLang();
  const sp = await searchParams;
  const view: View = sp.view === 'holidays' || sp.view === 'events' ? sp.view : 'month';
  let cal: Calendar;
  try {
    cal = await bff.api.fetch<Calendar>('/academics/calendar');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Calendar')} />
          <Card>{t(lang, 'The calendar is not available for this account.')}</Card>
        </main>
      );
    throw error;
  }
  const today = iso(new Date(Date.now() + 5.5 * 3_600_000)); // the school's day (IST)
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7);
  const picked =
    /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? '') && sp.day!.startsWith(month)
      ? sp.day!
      : today.startsWith(month)
        ? today
        : null;

  const holidays: Entry[] = cal.holidays.map((h) => ({
    key: `h${h.id}`,
    date: h.startsOn,
    end: h.endsOn,
    label: h.name,
    at: null,
    mark: h.kind === 'vacation' ? 'vacation' : h.kind === 'working_day' ? 'working_day' : 'holiday',
    note: null,
  }));
  const events: Entry[] = cal.events.map((e) => ({
    key: `e${e.id}`,
    date: e.startsOn,
    end: e.endsOn,
    label: e.title,
    at: e.startsAt,
    mark: e.kind === 'exam' ? 'exam' : 'event',
    note: e.description ?? null,
  }));
  const all = [...holidays, ...events].sort((a, b) => a.date.localeCompare(b.date));
  const monthStart = `${month}-01`;
  const monthEnd = iso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
  const inMonth = all.filter((e) => e.date <= monthEnd && e.end >= monthStart);
  const onPicked = picked ? all.filter((e) => e.date <= picked && e.end >= picked) : [];
  const monthTitle = utc(monthStart).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const daysOff = holidays.filter((h) => h.mark !== 'working_day');
  const next = daysOff.find((h) => h.end >= today);

  const tab = (v: View, label: string) => (
    <a
      key={v}
      href={v === 'month' ? '/calendar' : `/calendar?view=${v}`}
      aria-current={view === v ? 'page' : undefined}
    >
      {t(lang, label)}
    </a>
  );
  const list = (rows: Entry[], caption: string, withDays: boolean) => (
    <DataTable<Entry>
      caption={caption}
      density="dense"
      columns={[
        {
          key: 'date',
          header: t(lang, 'Date'),
          render: (e) => `${span(e.date, e.end)}${e.at ? ` · ${e.at}` : ''}`,
        },
        {
          key: 'label',
          header: withDays ? t(lang, 'Holiday') : t(lang, 'What'),
          render: (e) => (
            <>
              <strong>{e.label}</strong>
              {e.note ? <div className="ep-hcal__note">{e.note}</div> : null}
            </>
          ),
        },
        ...(withDays
          ? [
              {
                key: 'days',
                header: t(lang, 'Days'),
                render: (e: Entry) => String(daysOf(e.date, e.end)),
              },
            ]
          : []),
        {
          key: 'kind',
          header: t(lang, 'Kind'),
          render: (e) => <Badge tone={tone(e)}>{t(lang, MARK_LABEL[e.mark])}</Badge>,
        },
      ]}
      rows={rows}
      rowKey={(e) => e.key}
      emptyTitle={t(lang, 'Nothing scheduled')}
    />
  );

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Calendar')}
        title={
          view === 'month'
            ? monthTitle
            : view === 'holidays'
              ? t(lang, 'Holiday list')
              : t(lang, 'Events')
        }
        description={`${t(lang, 'Session')}: ${pretty(cal.from, true)} – ${pretty(cal.to, true)}`}
        actions={
          view === 'month' ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/calendar?month=${shift(month, -1)}`}
              >
                ‹ {t(lang, 'Previous')}
              </a>
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/calendar">
                {t(lang, 'Today')}
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/calendar?month=${shift(month, 1)}`}
              >
                {t(lang, 'Next')} ›
              </a>
            </span>
          ) : undefined
        }
      />
      <nav
        className="ep-tabs-links"
        aria-label={t(lang, 'Calendar')}
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {tab('month', 'Calendar')}
        {tab('holidays', 'Holiday list')}
        {tab('events', 'Events')}
      </nav>

      {view === 'month' ? (
        <>
          {next ? (
            <Card style={{ marginBottom: 'var(--sp-3)' }}>
              <strong>{t(lang, 'Next holiday')}:</strong> {next.label} · {span(next.date, next.end)}
            </Card>
          ) : null}
          <Card style={{ marginBottom: 'var(--sp-3)' }}>
            <MonthGrid lang={lang} month={month} entries={all} today={today} picked={picked} />
            <Legend lang={lang} />
          </Card>
          {picked ? (
            <Card title={pretty(picked, true)} style={{ marginBottom: 'var(--sp-3)' }}>
              <div id="day">
                {onPicked.length ? (
                  list(onPicked, pretty(picked, true), false)
                ) : (
                  <p style={{ margin: 0 }}>{t(lang, 'Nothing is scheduled on this day.')}</p>
                )}
              </div>
            </Card>
          ) : null}
          <Card title={t(lang, 'This month')}>{list(inMonth, t(lang, 'This month'), false)}</Card>
        </>
      ) : null}

      {view === 'holidays' ? (
        <>
          <Card style={{ marginBottom: 'var(--sp-3)' }}>
            <strong>{daysOff.length}</strong> {t(lang, 'holidays this session')} ·{' '}
            <strong>{daysOff.reduce((n, h) => n + daysOf(h.date, h.end), 0)}</strong>{' '}
            {t(lang, 'days in all')}
          </Card>
          <Card title={t(lang, 'Upcoming')} style={{ marginBottom: 'var(--sp-3)' }}>
            {list(
              holidays.filter((h) => h.end >= today),
              t(lang, 'Upcoming'),
              true,
            )}
          </Card>
          <Card title={t(lang, 'Earlier this year')}>
            {list(
              holidays.filter((h) => h.end < today),
              t(lang, 'Earlier this year'),
              true,
            )}
          </Card>
        </>
      ) : null}

      {view === 'events' ? (
        <>
          <Card title={t(lang, 'Upcoming')} style={{ marginBottom: 'var(--sp-3)' }}>
            {list(
              events.filter((e) => e.end >= today),
              t(lang, 'Upcoming'),
              false,
            )}
          </Card>
          <Card title={t(lang, 'Earlier this year')}>
            {list(
              events.filter((e) => e.end < today),
              t(lang, 'Earlier this year'),
              false,
            )}
          </Card>
        </>
      ) : null}
    </main>
  );
}
