import { Fragment } from 'react';
import { Badge, Card } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { iconOf, isHidden, type HomeLayout } from '@/lib/home-layout';
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
  assignedOn: string;
}

/**
 * The day a piece of work is for: an assignment's due date; homework's due date, else the day it was set (the
 * teachers' day sheet sets none); classwork is what was done in class (none).
 */
const workDay = (w: Work): string | null =>
  w.kind === 'classwork' ? null : w.kind === 'homework' ? (w.dueOn ?? w.assignedOn) : w.dueOn;
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

interface LibraryGlance {
  kind: string;
  id: string;
  holding: number;
  late: number;
  dueSoon: number;
  nextDue: string | null;
  ready: Array<{ title: string; until: string; library: string | null }>;
  waiting: number;
}

interface DateSheets {
  children: Array<{
    student: { id: string };
    exams: Array<{
      name: string;
      papers: Array<{ subject: string; examOn: string; startsAt: string | null }>;
    }>;
  }>;
}
interface Period {
  id: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}
interface Slot {
  weekday: number;
  periodId: string;
  subjectName: string | null;
  teacherName: string | null;
}

/** The Home before the school arranged it (docs/design/90): its glances and cards in their old order. */
const BEFORE = ['attendance_today', 'fees_due', 'homework_due', 'library', 'notices', 'coming_up'];

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
  layout,
}: {
  childId: string;
  audience: Audience;
  lang: Lang;
  /** The school's layout for this person (docs/design/90); null: Home as it always was. */
  layout: HomeLayout | null;
}) {
  const today = istToday();
  const tomorrow = addDays(today, 1);
  const isParent = audience === 'parent';
  // the cards in the school's order (only those) once it published a layout, else the old set
  const cardsByLayout = !!layout?.published;
  const order = cardsByLayout ? layout!.cards.map((c) => c.key) : BEFORE;
  const want = (key: string) => order.includes(key);
  const none = Promise.resolve(null);
  const [att, fees, viewer, notices, cal, birthdays, dayOf, consents, library, sheets] =
    await Promise.all([
      want('attendance_today')
        ? bff.api.fetch<Attendance>(`/attendance/mine?month=${today.slice(0, 7)}`).catch(() => null)
        : none,
      // a student's fees are view only; the old Home showed them to parents alone
      want('fees_due') && (isParent || cardsByLayout)
        ? bff.api.fetch<Fees>('/fees/mine').catch(() => null)
        : none,
      want('homework_due') || want('classes_today')
        ? bff.api.fetch<Viewer>('/academics/daily-work/viewer').catch(() => null)
        : none,
      want('notices')
        ? bff.api
            .fetch<{ data: Notice[] }>('/academics/notices?size=3')
            .then((r) => r.data)
            .catch(() => [] as Notice[])
        : ([] as Notice[]),
      want('coming_up') ? bff.api.fetch<Calendar>('/academics/calendar').catch(() => null) : none,
      want('coming_up')
        ? bff.api
            .fetch<{ data: Birthday[] }>(`/engagement/mine/birthdays/${childId}`)
            .then((r) => r.data)
            .catch(() => [] as Birthday[])
        : ([] as Birthday[]),
      // today on the bus, and what the school already knows of the day (approved leave, gate pass)
      want('attendance_today')
        ? bff.api
            .fetch<{ children: DayOf[] }>('/attendance/desk/mine/today')
            .then((r) => r.children.find((c) => c.id === childId) ?? null)
            .catch(() => null)
        : none,
      // consent forms waiting for an answer for this child (docs/design/28-consent-forms.md)
      audience === 'parent'
        ? bff.api
            .fetch<{
              forms: Array<{
                id: string;
                title: string;
                people: Array<{ id: string; canAnswer: boolean }>;
              }>;
            }>('/engagement/mine/consent-forms')
            .then((r) =>
              r.forms.filter((x) => x.people.some((p) => p.id === childId && p.canAnswer)),
            )
            .catch(() => [])
        : [],
      // the child's library books: held, due soon, late, kept for them (docs/design/36-library.md)
      want('library')
        ? bff.api
            .fetch<{ people: LibraryGlance[] }>('/library/portal/summary')
            .then((r) => r.people.find((p) => p.kind === 'student' && p.id === childId) ?? null)
            .catch(() => null)
        : none,
      want('next_exam')
        ? bff.api.fetch<DateSheets>('/exams/mine/date-sheets').catch(() => null)
        : none,
    ]);
  const section = viewer?.students.find((s) => s.id === childId)?.classSectionId ?? null;
  const [work, periods, slots] = await Promise.all([
    section && want('homework_due')
      ? bff.api
          .fetch<{ data: Work[] }>(`/academics/daily-work?size=50&classSectionId=${section}`)
          .then((r) => r.data)
          .catch(() => [] as Work[])
      : ([] as Work[]),
    section && want('classes_today')
      ? bff.api
          .fetch<{ data: Period[] }>('/academics/timetable/periods')
          .then((r) => r.data)
          .catch(() => [] as Period[])
      : ([] as Period[]),
    section && want('classes_today')
      ? bff.api
          .fetch<{ data: Slot[] }>(`/academics/timetable/slots?classSectionId=${section}`)
          .then((r) => r.data)
          .catch(() => [] as Slot[])
      : ([] as Slot[]),
  ]);

  const a = att?.children.find((c) => c.id === childId);
  const todayCode = a?.days.find((d) => d.date === today)?.code;
  const pct =
    a && a.summary.days > 0 ? Math.round((a.summary.present / a.summary.days) * 100) : null;
  const f = fees?.children.find((c) => c.student.id === childId);
  const nextDue = f?.instalments.find((i) => i.status !== 'paid' && Number(i.balance) > 0);
  // Daily work for today and tomorrow (homework by its day, assignments by their due date), the nearest first
  const soon = work
    .filter((w) => {
      const d = workDay(w);
      return d === today || d === tomorrow;
    })
    .sort((x, y) => (workDay(x) ?? '').localeCompare(workDay(y) ?? ''));
  const upcomingHoliday = cal?.holidays
    .filter((h) => h.endsOn >= today)
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn))[0];
  const upcomingEvents = (cal?.events ?? [])
    .filter((e) => e.startsOn >= today)
    .sort((x, y) => x.startsOn.localeCompare(y.startsOn))
    .slice(0, 2);
  const nextPaper = (sheets?.children.find((c) => c.student.id === childId)?.exams ?? [])
    .flatMap((e) => e.papers.map((p) => ({ ...p, exam: e.name })))
    .filter((p) => p.examOn >= today)
    .sort((x, y) =>
      `${x.examOn} ${x.startsAt ?? ''}`.localeCompare(`${y.examOn} ${y.startsAt ?? ''}`),
    )[0];
  // Monday is 1 in the timetable; Sunday has no classes
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const todays = periods
    .filter((p) => !p.isBreak)
    .map((p) => ({ p, s: slots.find((x) => x.weekday === weekday && x.periodId === p.id) }))
    .filter((x): x is { p: Period; s: Slot } => !!x.s);

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

  // each card of the layout and what it shows here: glances in the "Today at a glance" row, the rest as cards
  const glance: Record<string, React.ReactNode> = {
    attendance_today: (
      <>
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
        {dayOf?.rides && !isHidden(layout, '/transport') ? (
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
      </>
    ),
    fees_due:
      isParent || fees ? (
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
      ) : null,
    homework_due: (
      <Glance
        icon="book"
        label={t(lang, 'Daily work')}
        value={soon.length}
        note={
          soon.length
            ? soon
                .slice(0, 2)
                .map((w) => w.subjectName ?? w.title)
                .join(', ')
            : t(lang, 'Nothing for today or tomorrow')
        }
        href={`/homework?child=${childId}`}
      />
    ),
    library: library ? (
      <Glance
        icon="book"
        label={t(lang, 'Library books')}
        value={
          library.ready.length ? (
            <Badge tone="warning">
              {library.ready.length} {t(lang, 'ready to collect')}
            </Badge>
          ) : library.late ? (
            <Badge tone="danger">
              {library.late} {t(lang, 'overdue')}
            </Badge>
          ) : (
            library.holding
          )
        }
        note={
          library.ready.length
            ? `${library.ready[0]!.title} · ${t(lang, 'until')} ${dayLabel(library.ready[0]!.until)}`
            : library.holding
              ? library.dueSoon
                ? `${library.dueSoon} ${t(lang, 'due in the next 3 days')}`
                : library.nextDue
                  ? `${t(lang, 'Next due')} ${dayLabel(library.nextDue)}`
                  : `${library.holding} ${t(lang, 'on loan')}`
              : t(lang, 'No books on loan.')
        }
        href="/library"
      />
    ) : null,
    next_exam: (
      <Glance
        icon="file"
        label={t(lang, 'Next exam')}
        value={nextPaper ? dayLabel(nextPaper.examOn) : '—'}
        note={
          nextPaper
            ? `${nextPaper.subject} · ${nextPaper.exam}${nextPaper.startsAt ? ` · ${nextPaper.startsAt.slice(0, 5)}` : ''}`
            : t(lang, 'No exam coming up.')
        }
        href="/date-sheet"
      />
    ),
    coming_up: (
      <Glance
        icon="clipboard"
        label={t(lang, 'Next holiday')}
        value={upcomingHoliday ? dayLabel(upcomingHoliday.startsOn) : '—'}
        note={upcomingHoliday ? upcomingHoliday.name : t(lang, 'None announced')}
        href="/calendar"
      />
    ),
  };
  const card: Record<string, React.ReactNode> = {
    notices: (
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
    ),
    coming_up: (
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
    ),
    classes_today: (
      <Card title={t(lang, 'Today’s classes')}>
        {todays.length ? (
          <ul className="fp-list">
            {todays.map(({ p, s }) => (
              <li key={p.id}>
                <span>
                  {s.subjectName ?? t(lang, 'Free period')}
                  {s.teacherName ? ` · ${s.teacherName}` : ''}
                </span>
                <span className="fp-list__meta">
                  {p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">{t(lang, 'No classes today.')}</p>
        )}
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/timetable?child=${childId}`}>
          {t(lang, 'Timetable')}
        </a>
      </Card>
    ),
  };
  const glances = order.filter((k) => glance[k]);
  const cards = order.filter((k) => card[k]);

  return (
    <>
      {consents.length && !isHidden(layout, '/consents') ? (
        <p className="ep-alert ep-alert--warning" role="status">
          <strong>
            {consents.length === 1
              ? t(lang, 'A form waits for your answer')
              : `${consents.length} ${t(lang, 'forms wait for your answer')}`}
            :
          </strong>{' '}
          {consents
            .slice(0, 3)
            .map((x) => x.title)
            .join(', ')}
          .{' '}
          <a
            href={
              consents.length === 1
                ? `/consents/${consents[0]!.id}?student=${childId}`
                : '/consents'
            }
            style={{ textDecoration: 'underline' }}
          >
            {t(lang, 'Answer now')}
          </a>
        </p>
      ) : null}
      {layout ? (
        <section aria-labelledby="shortcuts-title">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
            }}
          >
            <h2 id="shortcuts-title" className="fp-section-title">
              {t(lang, 'Shortcuts')}
            </h2>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/home/shortcuts">
              {t(lang, 'Edit shortcuts')}
            </a>
          </div>
          <div className="fp-actions">
            {layout.shortcuts.map((x) => (
              <a key={x.href} className="fp-action" href={x.href}>
                <Icon name={iconOf(x.icon)} size={22} />
                <span>{t(lang, x.label)}</span>
              </a>
            ))}
            <a className="fp-action" href="#services-title">
              <Icon name="grid" size={22} />
              <span>{t(lang, 'All services')}</span>
            </a>
          </div>
        </section>
      ) : null}
      {glances.length ? (
        <section aria-labelledby="glance-title">
          <h2 id="glance-title" className="fp-section-title">
            {t(lang, 'Today at a glance')}
          </h2>
          <div className="fp-glances">
            {glances.map((k) => (
              <Fragment key={k}>{glance[k]}</Fragment>
            ))}
          </div>
        </section>
      ) : null}
      {cards.length ? (
        <div className="fp-two">
          {cards.map((k) => (
            <Fragment key={k}>{card[k]}</Fragment>
          ))}
        </div>
      ) : null}
      {layout ? null : (
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
      )}
    </>
  );
}
