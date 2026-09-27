import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { rateQuery, replyToQuery } from '../actions';

interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  subject: string;
  body: string;
  leaveFrom: string | null;
  leaveTo: string | null;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  assignedTo: string | null;
  decision: string | null;
  rating: number | null;
  ratingComment: string | null;
  openedAt: string;
  responses: Array<{
    id: string;
    author: string | null;
    authorKind: string;
    body: string;
    createdAt: string;
  }>;
}
const LABEL: Record<Query['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};

export default async function QueryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  let q: Query;
  try {
    q = await bff.api.fetch<Query>(`/engagement/mine/queries/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) redirect('/queries?error=not-found');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={`${q.number} · ${q.categoryName}`}
        title={q.subject}
        description={`${q.studentName} · opened ${new Date(q.openedAt).toLocaleDateString('en-IN')}${q.assignedTo ? ` · handled by ${q.assignedTo}` : ''}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <Badge
              tone={
                q.status === 'closed'
                  ? 'neutral'
                  : q.status === 'answered'
                    ? 'success'
                    : q.status === 'in_progress'
                      ? 'info'
                      : 'warning'
              }
            >
              {LABEL[q.status]}
            </Badge>
            {q.decision ? (
              <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>
                Leave {q.decision}
              </Badge>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/queries">
              Back
            </a>
          </span>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Saved.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{q.body}</p>
        {q.kind === 'leave' ? (
          <p className="ep-kicker" style={{ marginTop: 'var(--sp-2)' }}>
            Leave {q.leaveFrom} → {q.leaveTo}
          </p>
        ) : null}
      </Card>
      {q.responses.map((r) => (
        <Card
          key={r.id}
          elevated
          style={{
            marginBottom: 'var(--sp-2)',
            marginLeft: r.authorKind === 'staff' ? 0 : 'var(--sp-5)',
          }}
        >
          <div className="ep-kicker">
            {r.authorKind === 'staff' ? (r.author ?? 'School') : 'You'} ·{' '}
            {new Date(r.createdAt).toLocaleString('en-IN')}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
        </Card>
      ))}
      {q.status !== 'closed' ? (
        <Card title="Reply" style={{ marginTop: 'var(--sp-3)' }}>
          <form action={replyToQuery} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="body"
              rows={3}
              required
              maxLength={4000}
              aria-label="Reply"
            />
            <div>
              <Button type="submit">Send</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {['answered', 'closed'].includes(q.status) && !q.rating ? (
        <Card title="How was this handled?" style={{ marginTop: 'var(--sp-3)' }}>
          <form action={rateQuery} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <input type="radio" name="rating" value={n} defaultChecked={n === 5} /> {n}
                </label>
              ))}
            </div>
            <input
              className="ep-input"
              name="comment"
              placeholder="Comment (optional)"
              maxLength={500}
              aria-label="Comment"
            />
            <div>
              <Button type="submit" variant="secondary">
                Rate
              </Button>
            </div>
          </form>
        </Card>
      ) : q.rating ? (
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
          You rated this {q.rating}/5{q.ratingComment ? ` · ${q.ratingComment}` : ''}.
        </p>
      ) : null}
    </main>
  );
}
