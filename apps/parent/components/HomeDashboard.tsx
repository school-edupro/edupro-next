import { Badge, Card } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { t, type Lang } from '@/lib/i18n';
import type { Audience } from './FamilyShell';
import { Icon, type IconName } from './nav-icons';

interface Attendance {
  children: Array<{
    id: string;
    days: Array<{ date: string; code: string }>;
    summary: { days: number; present: number; absent: number };
  }>;
}
interface Fees {
  children: Array<{
    student: { id: string };
    instalments: Array<{ dueOn: string; label: string; balance: string; status: string }>;
    payableNow: string;
  }>;
}
interface Viewer {
  students: Array<{ id: string; classSectionId: string | null }>;
}
interface Work {
  id: string;
  kind: string;
  subjectName: string | null;
  title: string;
  dueOn: string | null;
}
interface Notice {
  id: string;
  title: string;
  publishFrom: string;
  isPinned: boolean;
}
interface Calendar {
  holidays: Array<{ id: string; name: string; startsOn: string; endsOn: string }>;
  events: Array<{ id: string; title: string; kind: string; startsOn: string }>;
}
interface Birthday {
  name: string;
  day: string;
  self: boolean;
}

interface DayOf {
  id: string;
  rides: boolean;
  busPick: string | null;
  busDrop: string | null;
  hint: { leave: unknown; pass: { kind: 'early_leave' | 'late_arrival' } | null } | null;
}
const BUS: Record<string, string> = {
  P: 'On the bus',
  A: 'Not on the bus',
  LV: 'On leave',
  GP: 'Gate pass',
  OT: 'Other arrangement',
};
const CODE: Record<string, [string, 'success' | 'danger' | 'warning' | 'info']> = {
  P: ['Present', 'success'],
  LV: ['On leave', 'info'],
  A: ['Absent', 'danger'],
  L: ['Late', 'warning'],
  SR: ['Short leave', 'warning'],
  H: ['Half day', 'warning'],
  OD: ['On duty', 'info'],
  SB: ['Stay back', 'info'],
};

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function Glance({
  icon,
  label,
  value,
  note,
  href,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  href: string;
}) {
  return (
    <a className="fp-glance" href={href}>
      <span className="fp-glance__icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className="fp-glance__body">
        <span className="fp-glance__label">{label}</span>
        <span className="fp-glance__value">{value}</span>
        {note ? <span className="fp-glance__note">{note}</span> : null}
      </span>
    </a>
  );
}

/** Home dashboard under the profile card: today at a glance, notices, upcoming dates, quick actions. */
export async function HomeDashboard({
  childId,
  audience,
  lang,
}: {
  childId: string;
  audience: Audience;
  lang: Lang;
}) {
  const today = istToday();
  const tomorrow = addDays(today, 1);
  const [att, fees, viewer, notices, cal, birthdays, dayOf] = await Promise.all([
    bff.api.fetch<Attendance>(`/attendance/mine?month=${today.slice(0, 7)}`).catch(() => null),
    audience === 'parent' ? bff.api.fetch<Fees>('/fees/mine').catch(() => null) : null,
    bff.api.fetch<Viewer>('/academics/daily-work/viewer').catch(() => null),
    bff.api
      .fetch<{ data: Notice[] }>('/academics/notices?size=3')
      .then((r) => r.data)
      .catch(() => [] as Notice[]),
    bff.api.fetch<Calendar>('/academics/calendar').catch(() => null),
    bff.api
      .fetch<{ data: Birthday[] }>(`/engagement/mine/birthdays/${childId}`)
      .then((r) => r.data)
      .catch(() => [] as Birthday[]),
    // today on the bus, and what the school already knows of the day (approved leave, gate pass)
    bff.api
      .fetch<{ children: DayOf[] }>('/attendance/desk/mine/today')
      .then((r) => r.children.find((c) => c.id === childId) ?? null)
      .catch(() => null),
  ]);
  const section = viewer?.students.find((s) => s.id === childId)?.classSectionId ?? null;
  const work = section
    ? await bff.api
        .fetch<{ data: Work[] }>(`/academics/daily-work?size=50&classSectionId=${section}`)
        .then((r) => r.data)
        .catch(() => [] as Work[])
    : [];

  const a = att?.children.find((c) => c.id === childId);
  const todayCode = a?.days.find((d) => d.date === today)?.code;
  const pct =
    a && a.summary.days > 0 ? Math.round((a.summary.present / a.summary.days) * 100) : null;
  const f = fees?.children.find((c) => c.student.id === childId);
  const nextDue = f?.instalments.find((i) => i.status !== 'paid' && Number(i.balance) > 0);
  const dueTomorrow = work.filter((w) => w.dueOn === tomorrow);
  const upcomingHoliday = cal?.holidays
    .filter((h) => h.endsOn >= today)
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn))[0];
  const upcomingEvents = (cal?.events ?? [])
    .filter((e) => e.startsOn >= today)
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn))
    .slice(0, 2);
  const isParent = audience === 'parent';

  const actions: Array<{ href: string; label: string; icon: IconName }> = isParent
    ? [
        { href: '/fees', label: 'Pay fees', icon: 'wallet' },
        { href: '/queries/new', label: 'Apply for leave', icon: 'inbox' },
        { href: '/queries/new', label: 'Ask the school', icon: 'message' },
        { href: '/appointments', label: 'Meet a teacher', icon: 'users' },
      ]
    : [
        { href: '/timetable', label: 'My timetable', icon: 'clipboard' },
        { href: '/homework', label: 'My homework', icon: 'book' },
        { href: '/results', label: 'My results', icon: 'chart' },
        { href: '/library', label: 'My library books', icon: 'file' },
      ];

  return (
    <>
      <section aria-labelledby="glance-title">
        <h2 id="glance-title" className="fp-section-title">
          {t(lang, 'Today at a glance')}
        </h2>
        <div className="fp-glances">
          <Glance
            icon="check"
            label={t(lang, 'Attendance today')}
            value={
              todayCode ? (
                <Badge tone={CODE[todayCode]?.[1] ?? 'info'}>
                  {t(lang, CODE[todayCode]?.[0] ?? todayCode)}
                </Badge>
              ) : (
                t(lang, 'Not marked yet')
              )
            }
            note={
              pct !== null
                ? `${pct}% ${t(lang, 'this month')} · ${a!.summary.present}/${a!.summary.days} ${t(lang, 'days')}`
                : t(lang, 'No school days this month yet')
            }
            href="/attendance"
          />
          {dayOf?.rides ? (
            <Glance
              icon="bus"
              label={t(lang, 'School bus today')}
              value={
                dayOf.busPick || dayOf.busDrop ? (
                  <Badge
                    tone={dayOf.busPick === 'A' || dayOf.busDrop === 'A' ? 'warning' : 'success'}
                  >
                    {[
                      dayOf.busPick
                        ? `${t(lang, 'Morning')}: ${t(lang, BUS[dayOf.busPick] ?? dayOf.busPick)}`
                        : null,
                      dayOf.busDrop
                        ? `${t(lang, 'Afternoon')}: ${t(lang, BUS[dayOf.busDrop] ?? dayOf.busDrop)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Badge>
                ) : (
                  t(lang, 'Not marked yet')
                )
              }
              note={
                dayOf.hint?.leave
                  ? t(lang, 'Leave is approved for today')
                  : dayOf.hint?.pass
                    ? t(
                        lang,
                        dayOf.hint.pass.kind === 'early_leave'
                          ? 'Gate pass: leaves early today'
                          : 'Gate pass: comes late today',
                      )
                    : t(lang, 'Marked by the bus teacher, morning and afternoon')
              }
              href="/attendance"
            />
          ) : null}
          {isParent ? (
            <Glance
              icon="wallet"
              label={t(lang, 'Fee due')}
              value={
                f
                  ? Number(f.payableNow) > 0
                    ? rupees(f.payableNow)
                    : nextDue
                      ? rupees(nextDue.balance)
                      : t(lang, 'All paid')
                  : '—'
              }
              note={
                nextDue
                  ? `${nextDue.label} · ${t(lang, 'due')} ${dayLabel(nextDue.dueOn)}`
                  : f
                    ? t(lang, 'Nothing due now')
                    : undefined
              }
              href="/fees"
            />
          ) : null}
          <Glance
            icon="book"
            label={t(lang, 'Homework due tomorrow')}
            value={dueTomorrow.length}
            note={
              dueTomorrow.length
                ? dueTomorrow
                    .slice(0, 2)
                    .map((w) => w.subjectName ?? w.title)
                    .join(', ')
                : t(lang, 'Nothing due tomorrow')
            }
            href={`/homework?child=${childId}`}
          />
          <Glance
            icon="clipboard"
            label={t(lang, 'Next holiday')}
            value={upcomingHoliday ? dayLabel(upcomingHoliday.startsOn) : '—'}
            note={upcomingHoliday ? upcomingHoliday.name : t(lang, 'None announced')}
            href="/calendar"
          />
        </div>
      </section>

      <div className="fp-two">
        <Card title={t(lang, 'Latest notices')}>
          {notices.length ? (
            <ul className="fp-list">
              {notices.map((n) => (
                <li key={n.id}>
                  <a href="/notices">{n.title}</a>
                  <span className="fp-list__meta">
                    {dayLabel(n.publishFrom.slice(0, 10))}
                    {n.isPinned ? ` · ${t(lang, 'Pinned')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">{t(lang, 'No notices yet.')}</p>
          )}
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/notices">
            {t(lang, 'All notices')}
          </a>
        </Card>
        <Card title={t(lang, 'Coming up')}>
          <ul className="fp-list">
            {birthdays.map((b) => (
              <li key={`${b.name}-${b.day}`}>
                <span>
                  {b.self
                    ? b.day === today
                      ? t(lang, isParent ? 'Happy birthday to your child!' : 'Happy birthday!')
                      : t(lang, isParent ? 'Your child’s birthday' : 'Your birthday')
                    : `${t(lang, 'Birthday')}: ${b.name}`}
                </span>
                <span className="fp-list__meta">
                  {b.day === today ? t(lang, 'Today') : dayLabel(b.day)}
                </span>
              </li>
            ))}
            {upcomingEvents.map((e) => (
              <li key={e.id}>
                <span>{e.title}</span>
                <span className="fp-list__meta">{dayLabel(e.startsOn)}</span>
              </li>
            ))}
            {!birthdays.length && !upcomingEvents.length ? (
              <li className="ep-field__help">{t(lang, 'Nothing in the next few days.')}</li>
            ) : null}
          </ul>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/calendar">
            {t(lang, 'School calendar')}
          </a>
        </Card>
      </div>

      <section aria-labelledby="actions-title">
        <h2 id="actions-title" className="fp-section-title">
          {t(lang, 'Quick actions')}
        </h2>
        <div className="fp-actions">
          {actions.map((x) => (
            <a key={x.label} className="fp-action" href={x.href}>
              <Icon name={x.icon} size={22} />
              <span>{t(lang, x.label)}</span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
