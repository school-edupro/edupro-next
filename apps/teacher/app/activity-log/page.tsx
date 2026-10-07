import { ActivityDay, Card, PageHeader, type ActivityDayData } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { saveActivityDraft, submitActivityDay } from './actions';

/** My daily activity log: what I did today in time slots, started from my timetable, then submitted. */
export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : '';
  let data: ActivityDayData | null = null;
  let problem = '';
  try {
    data = await bff.api.fetch<ActivityDayData>(
      `/staff/activity/mine${date ? `?date=${date}` : ''}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError)) throw error;
    problem =
      typeof error.problem.detail === 'string' && error.status === 409
        ? error.problem.detail
        : 'The daily activity log is not part of your role.';
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 1040, margin: '0 auto' }}>
      <PageHeader
        kicker="Daily activity log"
        title={data ? `My day · ${data.employee.name}` : 'My day'}
        description="Write what you did today: from, to, the kind of work and a line about it. Submitting is enough; your head sees it."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'submitted' ? 'Your day is submitted.' : 'Draft saved. Remember to submit it.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}
      <Card>
        {data ? (
          <ActivityDay
            data={data}
            path="/activity-log"
            saveDraft={saveActivityDraft}
            submit={submitActivityDay}
          />
        ) : (
          problem
        )}
      </Card>
    </main>
  );
}
