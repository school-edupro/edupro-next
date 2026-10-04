import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

type State = 'requested' | 'approved' | 'checked_in' | 'completed' | 'no_show';
interface Visit {
  id: string;
  number: string;
  state: State;
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
  page: { total: number };
  counts: { today: number; upcoming: number; past: number };
}
const STATE: Record<State, [string, 'warning' | 'success' | 'info' | 'neutral' | 'danger']> = {
  requested: ['Waiting for the front desk', 'warning'],
  approved: ['Confirmed', 'success'],
  checked_in: ['Arrived', 'info'],
  completed: ['Completed', 'neutral'],
  no_show: ['Did not come', 'danger'],
};
const IST = 'Asia/Kolkata';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WHEN = ['today', 'upcoming', 'past'] as const;
type When = (typeof WHEN)[number];
const PAGE_SIZE = 25;
/** The day (YYYY-MM-DD, school time) of a moment. */
const dayOf = (v: string) =>
  new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: 'short',
  });
const timeOf = (v: string) =>
  new Date(v).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });

/**
 * Appointments with me (0059): who comes to meet this member of staff, as a list (today, still to come,
 * past) or as a week calendar. The front desk confirms and moves appointments; the visitor's contact
 * details stay with the front desk.
 */
export default async function MyAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; when?: string; day?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const calendar = sp.view === 'calendar';
  const when: When = WHEN.includes(sp.when as When) ? (sp.when as When) : 'upcoming';
  const page = Math.max(1, Number(sp.page) || 1);
  const nowDay = dayOf(new Date().toISOString());
  const day = DATE.test(sp.day ?? '') ? sp.day! : nowDay;
  const weekFrom = monday(day);
  const query: Record<string, string> = calendar
    ? { from: weekFrom, to: addDays(weekFrom, 6), when: 'all', size: '200' }
    : { when, page: String(page), size: String(PAGE_SIZE) };
  let list: WithMe;
  try {
    list = await bff.api.fetch<WithMe>(
      `/appointments/with-me?${new URLSearchParams(query).toString()}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const visits = list.data;
  const days = calendar
    ? Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i))
    : [...new Set(visits.map((v) => dayOf(v.startsAt)))];
  const pages = Math.ceil(list.page.total / PAGE_SIZE);
  const TABS: Array<[When, string, number]> = [
    ['today', 'Today', list.counts.today],
    ['upcoming', 'Still to come', list.counts.upcoming],
    ['past', 'Past', list.counts.past],
  ];
  const weekHref = (d: string) => `/appointments?view=calendar&day=${d}`;
  const row = (v: Visit) => (
    <li
      key={v.id}
      style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
        <strong>
          {timeOf(v.startsAt)} · {v.visitorName ?? t(lang, 'Visitor')}
          {v.partySize > 1 ? ` + ${String(v.partySize - 1)}` : ''}
        </strong>
        <Badge tone={STATE[v.state][1]}>{t(lang, STATE[v.state][0])}</Badge>
      </div>
      <div>{v.purpose}</div>
      <div className="ep-field__help">
        {[
          v.number,
          v.student
            ? `${v.student}${v.section ? ` (${v.section})` : ''}${v.admissionNo ? ` · ${t(lang, 'Adm. no.')} ${v.admissionNo}` : ''}`
            : null,
          v.visitorOrg,
          v.place,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </li>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Appointments')}
        title={t(lang, 'Appointments with me')}
        description={t(
          lang,
          'Confirmed by the front desk. The front desk confirms and moves appointments.',
        )}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
              href="/appointments"
              aria-current={calendar ? undefined : 'page'}
            >
              {t(lang, 'List')}
            </a>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
              href={weekHref(day)}
              aria-current={calendar ? 'page' : undefined}
            >
              {t(lang, 'Calendar')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              {t(lang, 'Home')}
            </a>
          </span>
        }
      />
      {calendar ? (
        <nav
          aria-label={t(lang, 'Week')}
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={weekHref(addDays(day, -7))}>
            ← {t(lang, 'Earlier')}
          </a>
          <strong>
            {dayLabel(weekFrom)} – {dayLabel(addDays(weekFrom, 6))}
          </strong>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={weekHref(addDays(day, 7))}>
            {t(lang, 'Later')} →
          </a>
        </nav>
      ) : (
        <nav className="ep-tabs-links" aria-label={t(lang, 'Lists')}>
          {TABS.map(([k, label, n]) => (
            <a
              key={k}
              href={`/appointments?when=${k}`}
              aria-current={k === when ? 'page' : undefined}
            >
              {t(lang, label)} · {String(n)}
            </a>
          ))}
        </nav>
      )}
      {!calendar && visits.length === 0 ? (
        <Card>{t(lang, 'Nobody has a confirmed appointment with you here.')}</Card>
      ) : null}
      {days.map((d) => {
        const rows = visits.filter((v) => dayOf(v.startsAt) === d);
        return (
          <Card
            key={d}
            title={dayLabel(d)}
            className={calendar && d === nowDay ? 'ep-cal__day--today' : undefined}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {rows.length ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{rows.map(row)}</ul>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {t(lang, 'Nothing booked')}
              </p>
            )}
          </Card>
        );
      })}
      {!calendar && pages > 1 ? (
        <nav
          aria-label={t(lang, 'Pages')}
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}
        >
          {page > 1 ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/appointments?when=${when}&page=${String(page - 1)}`}
            >
              ← {t(lang, 'Previous')}
            </a>
          ) : null}
          <span className="ep-field__help">
            {t(lang, 'Page')} {page} / {pages}
          </span>
          {page < pages ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/appointments?when=${when}&page=${String(page + 1)}`}
            >
              {t(lang, 'Next')} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
