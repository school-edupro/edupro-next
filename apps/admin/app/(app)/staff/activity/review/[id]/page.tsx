import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ActivityNav } from '@/components/staff/ActivityNav';
import { markActivityReviewed, sendActivityBack } from '@/lib/activity-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Detail {
  employee: { id: string; name: string; code: string; department: string | null };
  log: {
    id: string;
    date: string;
    state: 'draft' | 'submitted' | 'reviewed' | 'returned';
    tomorrowPlan: string | null;
    pendingNote: string | null;
    submittedAt: string | null;
    late: boolean;
    reviewNote: string | null;
    reviewedBy: string | null;
    entries: Array<{
      from: string;
      to: string;
      category: string;
      description: string;
      source: string;
    }>;
    minutes: number;
  };
}
const STATE = {
  draft: 'Draft',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  returned: 'Sent back',
};
const hm = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`;

/** One employee's log of a day, for the reviewer: read it, mark it reviewed, or send it back. */
export default async function ActivityLogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  let d: Detail;
  try {
    d = await apiFetch<Detail>(`/staff/activity/logs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const canReview = me.permissions.includes('staff.activity.review');
  const open = d.log.state === 'submitted' || d.log.state === 'reviewed';
  return (
    <>
      <PageHeader
        kicker={`Staff · Daily activity log · ${d.log.date}`}
        title={`${d.employee.name} (${d.employee.code})`}
        description={`${d.employee.department ?? 'No department'} · ${hm(d.log.minutes)} logged in ${String(d.log.entries.length)} activities`}
        actions={
          <>
            <Badge tone={d.log.state === 'returned' ? 'warning' : 'info'}>
              {STATE[d.log.state]}
            </Badge>
            {d.log.late ? <Badge tone="warning">Late</Badge> : null}
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/staff/activity/review?date=${d.log.date}`}
            >
              Back to the day
            </a>
          </>
        }
      />
      <ActivityNav current="/staff/activity/review" permissions={me.permissions} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'returned' ? 'Sent back to the employee.' : 'Marked reviewed.'}
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
      <Card title="Activities" style={{ marginBottom: 'var(--sp-4)' }}>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Activities of the day"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Activities of the day in time order</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Category</th>
                <th scope="col">What was done</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {d.log.entries.map((e, i) => (
                <tr key={String(i)}>
                  <td>{e.from}</td>
                  <td>{e.to}</td>
                  <td>{e.category}</td>
                  <td>{e.description}</td>
                  <td>
                    {e.source === 'manual'
                      ? 'Typed'
                      : e.source === 'timetable'
                        ? 'Timetable'
                        : 'Substitution'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.log.pendingNote ? (
          <p>
            <strong>Pending / carried forward:</strong> {d.log.pendingNote}
          </p>
        ) : null}
        {d.log.tomorrowPlan ? (
          <p style={{ marginBottom: 0 }}>
            <strong>Plan for tomorrow:</strong> {d.log.tomorrowPlan}
          </p>
        ) : null}
      </Card>
      <Card title="Review">
        {d.log.reviewNote ? (
          <p style={{ marginTop: 0 }}>
            Remark{d.log.reviewedBy ? ` by ${d.log.reviewedBy}` : ''}: {d.log.reviewNote}
          </p>
        ) : null}
        {canReview && open ? (
          <form
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <input type="hidden" name="id" value={d.log.id} />
            <InputField
              id="rv-note"
              name="note"
              label="Remark (needed to send back)"
              maxLength={500}
            />
            <Button type="submit" formAction={markActivityReviewed}>
              Mark reviewed
            </Button>
            <Button type="submit" variant="secondary" formAction={sendActivityBack}>
              Send back
            </Button>
          </form>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {d.log.state === 'returned'
              ? 'Sent back: the employee corrects it and submits again.'
              : 'Nothing to do here.'}
          </p>
        )}
      </Card>
    </>
  );
}
