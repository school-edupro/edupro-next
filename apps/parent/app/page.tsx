import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** Parent home (S5-08): sign-in round trip, school choice and the feature shell; content lands in Sprint 9. */
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
  const tiles: Array<[string, string, string?]> = [
    ['Homework', 'Homework, classwork and assignments', '/homework'],
    ['Notices', 'School notices and circulars', '/notices'],
    ['Calendar', 'Holidays and the almanac', '/calendar'],
    ['Attendance', 'Daily attendance and leave requests'],
    ['Fees', 'Dues, receipts and online payment'],
    ['Results', 'Report cards and progress'],
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={school ? school.schoolName : 'EduPro'}
        title={`Namaste, ${me.user.displayName}`}
        description={
          me.memberships.length > 1
            ? 'Choose the school to view.'
            : 'Your child’s school, in your pocket.'
        }
        actions={
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              Sign out
            </button>
          </form>
        }
      />
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
                {title}
              </div>
              <div className="ep-field__help">{help}</div>
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
