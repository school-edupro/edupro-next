import { PageHeader } from '@edupro/ui';
import { Icon } from '@/components/nav-icons';
import { QuickActions, type QuickTile } from '@/components/QuickActions';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { screenIcon, staffMenu } from '@/lib/staff-menu';

interface MeCard {
  roles: string[];
  designation: string | null;
}
interface HostelToday {
  boarders: number;
  away: number;
  overdue: number;
  toHandOver: number;
  waiting: number;
  sessions: number;
  rollsTaken: number;
}

interface LibraryToday {
  kind: string;
  holding: number;
  late: number;
  dueSoon: number;
  ready: Array<{ title: string }>;
}

/**
 * Staff home: who I am here (designation and roles), today's figures for what I do, then only the
 * screens I may open, grouped as in the menu. Nothing I cannot use is shown.
 */
/** a line of the teacher's "To enter" (docs/design/71) */
interface ToEnter {
  examId: string;
  exam: string;
  section: string;
  area: 'marks' | 'indicators' | 'remarks' | 'health';
  what: string;
  done: number;
  total: number;
  href: string;
  /** reopened for entry by the admin: correct and submit it */
  reopened?: boolean;
}

export default async function HomePage() {
  const lang = await currentLang();
  const me = await bff.api.me();
  const can = (p: string) => me.permissions.includes(p);
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [card, unread, approvals, leaves, passes, hostel, library, toEnter, landing] =
    await Promise.all([
      quiet(bff.api.fetch<MeCard>('/me/card'), { roles: [], designation: null }),
      quiet(
        bff.api.fetch<{ unread: number }>('/comms/inbox/unread').then((r) => r.unread),
        0,
      ),
      quiet(
        bff.api
          .fetch<{ data: unknown[] }>('/engagement/mine/consent-approvals')
          .then((r) => r.data.length),
        0,
      ),
      can('attendance.leave.decide')
        ? quiet(
            bff.api.fetch<{ inbox: number }>('/attendance/leaves?tab=inbox').then((r) => r.inbox),
            0,
          )
        : Promise.resolve(null),
      quiet(
        bff.api.fetch<{ data: unknown[] }>('/gate-passes/inbox').then((r) => r.data.length),
        0,
      ),
      can('hostel.rollcall.mark') || can('hostel.leave.view')
        ? quiet(bff.api.fetch<HostelToday>('/hostel/today'), null)
        : Promise.resolve(null),
      // my library books (docs/design/36-library.md, "Library round 3", part 4)
      quiet(
        bff.api
          .fetch<{ people: LibraryToday[] }>('/library/portal/summary')
          .then((r) => r.people.find((p) => p.kind === 'employee') ?? null),
        null,
      ),
      // what is mine to enter in the open exams (docs/design/71)
      can('exams.marks.view')
        ? quiet(
            bff.api.fetch<{ data: ToEnter[] }>('/exams/my-entry').then((r) => r.data),
            [] as ToEnter[],
          )
        : Promise.resolve([] as ToEnter[]),
      // a role that lands on the admin app (its Quick Actions offer it)
      quiet(
        bff.api.fetch<{ roleName: string | null }>('/dashboard').then((r) => r.roleName ?? null),
        null,
      ),
    ]);
  const groups = staffMenu(me, { approvals });
  // Quick Actions (docs/design/83, "As built — Quick Actions for every user"): the screens this role
  // opens, each with its icon
  const tiles: QuickTile[] = groups.flatMap((g) =>
    g.items.map((i) => ({
      href: i.href,
      label: `${t(lang, i.label)}${i.href === '/consent-approvals' && approvals ? ` (${String(approvals)})` : ''}`,
      section: t(lang, g.label),
      icon: screenIcon(i.href, g.icon),
    })),
  );
  const adminUrl = (process.env.ADMIN_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const adminTiles: QuickTile[] = landing
    ? [
        {
          href: `${adminUrl}/`,
          label: t(lang, 'Open the admin app'),
          section: landing,
          icon: 'grid',
          external: true,
        },
      ]
    : [];

  // today's figures, only for what this person does
  const today: Array<{ label: string; value: string; href: string; hint?: string }> = [];
  if (hostel) {
    today.push(
      {
        label: t(lang, 'Roll-calls taken'),
        value: `${String(hostel.rollsTaken)} / ${String(hostel.sessions)}`,
        href: '/hostel',
        hint: `${String(hostel.boarders)} ${t(lang, 'boarders')}`,
      },
      {
        label: t(lang, 'Pupils away'),
        value: String(hostel.away),
        href: '/hostel',
        hint: hostel.overdue ? `${String(hostel.overdue)} ${t(lang, 'overdue')}` : undefined,
      },
      { label: t(lang, 'To hand over'), value: String(hostel.toHandOver), href: '/hostel' },
      { label: t(lang, 'Hostel leave to decide'), value: String(hostel.waiting), href: '/hostel' },
    );
  }
  if (leaves !== null)
    today.push({
      label: t(lang, 'Student leave to decide'),
      value: String(leaves),
      href: '/leaves',
    });
  if (approvals)
    today.push({
      label: t(lang, 'Answers to approve'),
      value: String(approvals),
      href: '/consent-approvals',
    });
  if (passes)
    today.push({
      label: t(lang, 'Gate passes waiting'),
      value: String(passes),
      href: '/gate-passes',
    });
  if (library && (library.holding || library.ready.length))
    today.push({
      label: t(lang, 'Library books with me'),
      value: String(library.holding),
      href: '/library',
      hint: library.ready.length
        ? `${String(library.ready.length)} ${t(lang, 'ready to collect')}`
        : library.late
          ? `${String(library.late)} ${t(lang, 'overdue')}`
          : library.dueSoon
            ? `${String(library.dueSoon)} ${t(lang, 'due in the next 3 days')}`
            : undefined,
    });
  if (toEnter.length)
    today.push({
      label: t(lang, 'Exam entries to finish'),
      value: String(toEnter.length),
      href: '#to-enter',
    });
  today.push({ label: t(lang, 'New messages'), value: String(unread), href: '/messages' });

  const who = [card.designation, ...card.roles.filter((r) => r !== card.designation)]
    .filter(Boolean)
    .join(' · ');
  return (
    <main>
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`${t(lang, 'Welcome,')} ${me.user.displayName}`}
        description={who || undefined}
      />
      <section aria-labelledby="today-h" style={{ marginBottom: 'var(--sp-5)' }}>
        <h2 id="today-h" className="ep-card__title">
          {t(lang, 'Today')}
        </h2>
        <div className="ep-dash-kpis">
          {today.map((k) => (
            <a key={k.label} href={k.href} className="ep-card ep-card--elevated ep-staff-kpi">
              <span className="ep-kpi__value">{k.value}</span>
              <span className="ep-kpi__label">{k.label}</span>
              {k.hint ? <span className="ep-field__help">{k.hint}</span> : null}
            </a>
          ))}
        </div>
      </section>
      {toEnter.length ? (
        <section id="to-enter" aria-labelledby="to-enter-h" style={{ marginBottom: 'var(--sp-5)' }}>
          <h2 id="to-enter-h" className="ep-card__title">
            {t(lang, 'To enter')}
          </h2>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t(lang, 'To enter')}
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{t(lang, 'To enter')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t(lang, 'Exam')}</th>
                  <th scope="col">{t(lang, 'Section')}</th>
                  <th scope="col">{t(lang, 'What')}</th>
                  <th scope="col">{t(lang, 'Entered')}</th>
                  <th scope="col">
                    <span className="ep-sr-only">{t(lang, 'Open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {toEnter.slice(0, 12).map((x) => (
                  <tr key={`${x.examId}-${x.section}-${x.area}-${x.what}`}>
                    <td>{x.exam}</td>
                    <td>{x.section}</td>
                    <td>
                      {t(lang, x.what)}
                      {x.area === 'remarks' ? ` (${t(lang, 'remarks')})` : ''}
                      {x.reopened ? ` (${t(lang, 'Reopened')})` : ''}
                    </td>
                    <td>
                      {x.done} {t(lang, 'of')} {x.total}
                    </td>
                    <td>
                      <a className="ep-btn ep-btn--ghost ep-btn--sm" href={x.href}>
                        {t(lang, 'Enter')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {toEnter.length > 12 ? (
            <p className="ep-field__help">
              {t(lang, 'and')} {toEnter.length - 12} {t(lang, 'more')}
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="ep-card" aria-labelledby="qa-h" style={{ marginBottom: 'var(--sp-5)' }}>
        <h2
          id="qa-h"
          className="ep-card__title"
          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
        >
          <Icon name="grid" size={20} />
          {t(lang, 'Quick Actions')}
        </h2>
        <QuickActions
          tiles={tiles}
          admin={adminTiles}
          words={{
            search: t(lang, 'Search pages'),
            staff: t(lang, 'Staff app'),
            admin: t(lang, 'Admin app'),
            none: t(lang, 'No page for your role yet.'),
            noMatch: t(lang, 'No page matches'),
          }}
        />
      </section>
    </main>
  );
}
