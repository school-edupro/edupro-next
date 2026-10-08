import { ActivityDay, Card, PageHeader, type ActivityDayData } from '@edupro/ui';
import { ActivityNav } from '@/components/staff/ActivityNav';
import { saveActivityDraft, submitActivityDay } from '@/lib/activity-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';

/** My daily activity log: what I did today in time slots, saved as a draft or submitted. */
export default async function MyActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : '';
  let data: ActivityDayData | null = null;
  let problem = '';
  try {
    data = await apiFetch<ActivityDayData>(`/staff/activity/mine${date ? `?date=${date}` : ''}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    problem =
      typeof error.problem.detail === 'string' && error.status === 409
        ? error.problem.detail
        : 'The daily activity log is not part of your role.';
  }
  return (
    <>
      <PageHeader
        kicker="Staff · Daily activity log"
        title={data ? `My day · ${data.employee.name}` : 'My day'}
        description="Write what you did today: from, to, the kind of work and a line about it. Submitting is enough; your head sees it."
      />
      <ActivityNav current="/staff/activity" permissions={me.permissions} />
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
            path="/staff/activity"
            saveDraft={saveActivityDraft}
            submit={submitActivityDay}
            reportPath="/api/staff/my-activity-report"
          />
        ) : (
          problem
        )}
      </Card>
    </>
  );
}
