import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** Teacher home (S5-08): sign-in round trip and the feature shell; attendance and daily work land in Sprint 9. */
export default async function HomePage() {
  let me;
  try {
    me = await bff.api.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      redirect('/login?error=session-expired');
    throw error;
  }
  const school = me.memberships.find((m) => m.schoolId === me.school?.id) ?? me.memberships[0];
  const can = (p: string) => me.permissions.includes(p);
  const tiles: Array<[string, string, boolean, string?]> = [
    [
      'My classes',
      'Your sections, subjects and this week’s timetable',
      can('academics.timetable.view'),
      '/timetable',
    ],
    [
      'Attendance',
      'Mark today’s attendance for your sections',
      can('attendance.session.mark'),
      '/attendance',
    ],
    ['Daily work', 'Post homework and classwork', can('academics.daily_work.post'), '/daily-work'],
    [
      'Lesson plans',
      'Weekly plans with approvals',
      can('academics.lesson_plan.manage'),
      '/lesson-plans',
    ],
    [
      'Queries',
      'Family queries and leave requests for your sections',
      can('engagement.query.respond'),
      '/queries',
    ],
    ['Students', 'Your sections and student profiles', can('people.student.view')],
    ['Marks', 'Exam marks and remarks', false],
    ['Notices', 'Notices and circulars for staff', can('academics.notice.view'), '/notices'],
    ['Calendar', 'Holidays and the almanac', can('academics.calendar.view'), '/calendar'],
    ['Leave', 'Apply for leave and approvals', true],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`Welcome, ${me.user.displayName}`}
        description={`${me.permissions.length} permissions in this school`}
        actions={
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              Sign out
            </button>
          </form>
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
            Session
          </label>
          <select
            id="academicYearId"
            name="academicYearId"
            className="ep-select"
            defaultValue={me.academicYear?.id ?? ''}
          >
            {me.academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code} · {y.status}
              </option>
            ))}
          </select>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            View
          </button>
          {me.academicYear && me.academicYear.status !== 'active' ? (
            <span className="ep-badge ep-badge--warning">
              Viewing a previous session (read-only)
            </span>
          ) : null}
        </form>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {tiles.map(([title, help, enabled, href]) => {
          const body = (
            <Card key={title} elevated style={{ opacity: enabled ? 1 : 0.55, height: '100%' }}>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  color: 'var(--text-heading)',
                }}
              >
                {title}
              </div>
              <div className="ep-field__help">{help}</div>
            </Card>
          );
          return href && enabled ? (
            <a key={title} href={href} style={{ textDecoration: 'none' }}>
              {body}
            </a>
          ) : (
            body
          );
        })}
      </div>
    </main>
  );
}
