import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { ChildProfileCard, type FamilyChild } from '@/components/ChildProfileCard';
import { audienceOf } from '@/components/FamilyShell';
import { HomeDashboard } from '@/components/HomeDashboard';
import { Icon, type IconName } from '@/components/nav-icons';

const SERVICES: Array<{
  href: string;
  icon: IconName;
  title: string;
  parent: string;
  student: string;
  parentOnly?: boolean;
}> = [
  {
    href: '/homework',
    icon: 'book',
    title: 'Homework',
    parent: 'Homework, classwork and assignments',
    student: 'My homework, classwork and assignments',
  },
  {
    href: '/attendance',
    icon: 'check',
    title: 'Attendance',
    parent: 'Daily attendance of your children',
    student: 'My daily attendance',
  },
  {
    href: '/timetable',
    icon: 'clipboard',
    title: 'Timetable',
    parent: 'The week’s periods and teachers',
    student: 'My periods and teachers',
  },
  {
    href: '/results',
    icon: 'chart',
    title: 'Results',
    parent: 'Report cards and progress',
    student: 'My report cards and progress',
  },
  {
    href: '/notices',
    icon: 'bell',
    title: 'Notices',
    parent: 'School notices and circulars',
    student: 'School notices and circulars',
  },
  {
    href: '/calendar',
    icon: 'clipboard',
    title: 'Calendar',
    parent: 'Holidays and the almanac',
    student: 'Holidays and the almanac',
  },
  {
    href: '/fees',
    icon: 'wallet',
    title: 'Fees',
    parent: 'Dues, receipts and online payment',
    student: '',
    parentOnly: true,
  },
  {
    href: '/transport',
    icon: 'bus',
    title: 'School bus',
    parent: 'Boarding and alighting alerts',
    student: 'My bus and stop',
  },
  {
    href: '/library',
    icon: 'book',
    title: 'Library',
    parent: 'Books on loan and fines',
    student: 'My books on loan',
  },
  {
    href: '/queries',
    icon: 'message',
    title: 'Queries',
    parent: 'Ask, complain or apply for leave',
    student: '',
    parentOnly: true,
  },
  {
    href: '/appointments',
    icon: 'users',
    title: 'Appointments',
    parent: 'Meet a teacher; gate passes',
    student: '',
    parentOnly: true,
  },
  {
    href: '/consents',
    icon: 'key',
    title: 'Consent forms',
    parent: 'Trips, activities and permissions',
    student: '',
    parentOnly: true,
  },
  {
    href: '/certificates',
    icon: 'file',
    title: 'Certificates',
    parent: 'Certificates issued to your children',
    student: 'My certificates',
  },
  {
    href: '/health',
    icon: 'heart',
    title: 'Health',
    parent: 'Clinic visits and health checks',
    student: 'My clinic visits and health checks',
  },
  {
    href: '/assistant',
    icon: 'message',
    title: 'Assistant',
    parent: 'Ask about fees, attendance and homework',
    student: 'Ask about attendance and homework',
  },
  {
    href: '/help',
    icon: 'book',
    title: 'Help',
    parent: 'Answers to the common questions',
    student: 'Answers to the common questions',
  },
];

/** Parent and student home: the child's profile card, today at a glance, notices, dates and services. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; child?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let me;
  try {
    me = await bff.api.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      redirect('/login?error=session-expired');
    throw error;
  }
  const isFamily = me.permissions.includes('engagement.family.view');
  // DPDP onboarding (S11): a family reads the current privacy notice once per version before using the app
  if (!sp.welcome && isFamily) {
    try {
      const ob = await bff.api.fetch<{ required: boolean }>('/engagement/onboarding');
      if (ob.required) redirect('/onboarding');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  const audience = audienceOf(me);
  const kids: FamilyChild[] = isFamily
    ? await bff.api
        .fetch<{ children: FamilyChild[] }>('/engagement/family')
        .then((r) => r.children)
        .catch(() => [])
    : [];
  const chosen = await chosenChild(sp.child);
  const child = kids.find((c) => c.id === chosen?.id) ?? kids[0];
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  return (
    <main className="fp-home">
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`${t(lang, 'Namaste')}, ${me.user.displayName}`}
        description={t(
          lang,
          audience === 'student'
            ? 'Here is your day at school.'
            : 'Here is your child’s day at school.',
        )}
      />
      {me.memberships.length > 1 ? (
        <form method="post" action="/api/context" className="fp-school-switch">
          <select
            name="schoolId"
            className="ep-select"
            defaultValue={me.school?.id ?? ''}
            aria-label={t(lang, 'School')}
          >
            {me.memberships.map((m) => (
              <option key={m.schoolId} value={m.schoolId}>
                {m.schoolName}
              </option>
            ))}
          </select>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            {t(lang, 'Switch')}
          </button>
        </form>
      ) : null}
      {child ? (
        <>
          <ChildSwitch lang={lang} back="/" current={child.id} />
          <ChildProfileCard child={child} lang={lang} />
          <HomeDashboard childId={child.id} audience={audience} lang={lang} />
        </>
      ) : isFamily ? (
        <Card>
          {t(
            lang,
            'Your account is not linked to a student yet. Please contact the school office.',
          )}
        </Card>
      ) : null}
      <section aria-labelledby="services-title">
        <h2 id="services-title" className="fp-section-title">
          {t(lang, 'All services')}
        </h2>
        <div className="fp-services">
          {SERVICES.filter((s) => audience === 'parent' || !s.parentOnly).map((s) => (
            <a key={s.href} className="fp-service" href={s.href}>
              <span className="fp-service__icon" aria-hidden="true">
                <Icon name={s.icon} size={22} />
              </span>
              <span>
                <span className="fp-service__title">{t(lang, s.title)}</span>
                <span className="fp-service__help">{t(lang, s[audience])}</span>
              </span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
