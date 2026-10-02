import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/** Teacher home (S5-08): sign-in round trip and the feature shell; attendance and daily work land in Sprint 9. */
export default async function HomePage() {
  const lang = await currentLang();
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
      t(lang, 'Messages'),
      t(lang, 'SMS, WhatsApp and email the school sent you'),
      true,
      '/messages',
    ],
    [
      t(lang, 'My classes'),
      t(lang, 'Your sections, subjects and this week’s timetable'),
      can('academics.timetable.view'),
      '/timetable',
    ],
    [
      t(lang, 'Attendance'),
      t(lang, 'Mark today’s attendance for your sections'),
      can('attendance.session.mark'),
      '/attendance',
    ],
    [
      t(lang, 'Daily work'),
      t(lang, 'Post homework and classwork'),
      can('academics.daily_work.post'),
      '/daily-work',
    ],
    [
      t(lang, 'Lesson plans'),
      t(lang, 'Weekly plans with approvals'),
      can('academics.lesson_plan.manage'),
      '/lesson-plans',
    ],
    [
      t(lang, 'Queries'),
      t(lang, 'Family queries and leave requests for your sections'),
      can('engagement.query.respond'),
      '/queries',
    ],
    [
      t(lang, 'Students'),
      t(lang, 'Your sections and student profiles'),
      can('people.student.view'),
    ],
    [
      t(lang, 'Marks'),
      t(lang, 'Enter exam marks for your subjects'),
      can('exams.marks.enter'),
      '/marks',
    ],
    [
      t(lang, 'Exam register'),
      t(lang, 'Remarks, exam attendance, height and weight'),
      can('exams.remark.enter'),
      '/exam-register',
    ],
    [
      t(lang, 'Assistant'),
      t(lang, 'Ask about your sections in English, Hindi or Hinglish'),
      can('insights.assistant.use'),
      '/assistant',
    ],
    [
      t(lang, 'Notices'),
      t(lang, 'Notices and circulars for staff'),
      can('academics.notice.view'),
      '/notices',
    ],
    [
      t(lang, 'Calendar'),
      t(lang, 'Holidays and the almanac'),
      can('academics.calendar.view'),
      '/calendar',
    ],
    [t(lang, 'Leave'), t(lang, 'Apply for leave and approvals'), true],
    [t(lang, 'Help'), t(lang, 'Answers to the common questions'), true, '/help'],
    [
      t(lang, 'Report an issue'),
      t(lang, 'Tell the support desk during hypercare'),
      can('platform.hypercare.report'),
      '/issues',
    ],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`${t(lang, 'Welcome,')} ${me.user.displayName}`}
        description={`${me.permissions.length} ${t(lang, 'permissions in this school')}`}
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
                {y.code} · {y.status}
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
