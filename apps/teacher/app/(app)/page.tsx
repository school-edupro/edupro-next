import { PageHeader } from '@edupro/ui';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { staffMenu } from '@/lib/staff-menu';

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

/**
 * Staff home: who I am here (designation and roles), today's figures for what I do, then only the
 * screens I may open, grouped as in the menu. Nothing I cannot use is shown.
 */
export default async function HomePage() {
  const lang = await currentLang();
  const me = await bff.api.me();
  const can = (p: string) => me.permissions.includes(p);
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [card, unread, approvals, leaves, passes, hostel] = await Promise.all([
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
  ]);
  const groups = staffMenu(me, { approvals });

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
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`g-${g.id}`} style={{ marginBottom: 'var(--sp-5)' }}>
          <h2 id={`g-${g.id}`} className="ep-card__title">
            {t(lang, g.label)}
          </h2>
          <div className="ep-staff-tiles">
            {g.items.map((i) => (
              <a key={i.href} href={i.href} className="ep-card ep-card--elevated ep-staff-tile">
                <span className="ep-staff-tile__title">
                  {t(lang, i.label)}
                  {i.href === '/consent-approvals' && approvals ? ` (${String(approvals)})` : ''}
                </span>
                <span className="ep-field__help">{t(lang, i.help)}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
