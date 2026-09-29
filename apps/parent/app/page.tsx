import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/** Parent home (S5-08): sign-in round trip, school choice and the feature shell; content lands in Sprint 9. */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
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
  // DPDP onboarding (S11): a family reads the current privacy notice once per version before using the app
  if (!sp.welcome && me.permissions.includes('engagement.family.view')) {
    try {
      const ob = await bff.api.fetch<{ required: boolean }>('/engagement/onboarding');
      if (ob.required) redirect('/onboarding');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  const tiles: Array<[string, string, string?]> = [
    ['Homework', 'Homework, classwork and assignments', '/homework'],
    ['Notices', 'School notices and circulars', '/notices'],
    ['Calendar', 'Holidays and the almanac', '/calendar'],
    ['Attendance', 'Daily attendance of your children', '/attendance'],
    ['Timetable', 'The week’s periods and teachers', '/timetable'],
    ['Queries', 'Ask, complain or apply for leave', '/queries'],
    ['School bus', 'Boarding and alighting alerts', '/transport'],
    ['Profile', 'Your details, consents and change requests', '/profile'],
    ['Fees', 'Dues, receipts and online payment', '/fees'],
    ['Assistant', 'Ask about fees, attendance and homework', '/assistant'],
    ['Results', 'Report cards and progress', '/results'],
    ['Library', 'Books on loan and fines', '/library'],
    ['Appointments', 'Meet a teacher; gate passes', '/appointments'],
    ['Consent forms', 'Trips, activities and permissions', '/consents'],
    ['Certificates', 'Certificates issued to your children', '/certificates'],
    ['Health', 'Clinic visits and health checks', '/health'],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`Namaste, ${me.user.displayName}`}
        description={
          me.memberships.length > 1
            ? t(lang, 'Choose the school to view.')
            : t(lang, 'Your child’s school, in your pocket.')
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=/`}
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </a>
            <form method="post" action="/api/auth/logout">
              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                {t(lang, 'Sign out')}
              </button>
            </form>
          </span>
        }
      />
      {me.academicYears && me.academicYears.length > 1 ? (
        <form
          method="post"
          action="/api/context"
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            alignItems: 'center',
            marginBottom: 'var(--sp-3)',
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor="academicYearId" className="ep-field__label" style={{ margin: 0 }}>
            {t(lang, 'Session')}
          </label>
          <select
            id="academicYearId"
            name="academicYearId"
            className="ep-select"
            defaultValue={me.academicYear?.id ?? ''}
          >
            {me.academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
                {y.status === 'active' ? ` · ${t(lang, 'current')}` : ` · ${t(lang, 'previous')}`}
              </option>
            ))}
          </select>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            {t(lang, 'View')}
          </button>
          {me.academicYear && me.academicYear.status !== 'active' ? (
            <span className="ep-badge ep-badge--warning">
              {t(lang, 'Viewing a previous session (read-only)')}
            </span>
          ) : null}
        </form>
      ) : null}
      {me.memberships.length > 1 ? (
        <form
          method="post"
          action="/api/context"
          style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}
        >
          <select
            name="schoolId"
            className="ep-select"
            defaultValue={me.school?.id ?? ''}
            aria-label="School"
          >
            {me.memberships.map((m) => (
              <option key={m.schoolId} value={m.schoolId}>
                {m.schoolName}
              </option>
            ))}
          </select>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Switch
          </button>
        </form>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {tiles.map(([title, help, href]) => {
          const body = (
            <Card key={title} elevated style={{ opacity: href ? 1 : 0.6, height: '100%' }}>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  color: 'var(--text-heading)',
                }}
              >
                {t(lang, title)}
              </div>
              <div className="ep-field__help">{t(lang, help)}</div>
            </Card>
          );
          return href ? (
            <a key={title} href={href} style={{ textDecoration: 'none' }}>
              {body}
            </a>
          ) : (
            body
          );
        })}
      </div>
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-4)' }}>
        Installed as an app from the browser menu. Features open here sprint by sprint from Sprint
        9.
      </p>
    </main>
  );
}
