import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { respond } from '../actions';

interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  section: string | null;
  raisedBy: string | null;
  subject: string;
  body: string;
  leaveFrom: string | null;
  leaveTo: string | null;
  status: 'open' | 'in_progress' | 'answered' | 'closed';
  decision: string | null;
  rating: number | null;
  openedAt: string;
  responses: Array<{
    id: string;
    author: string | null;
    authorKind: string;
    body: string;
    isInternal: boolean;
    createdAt: string;
  }>;
}

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
    q = await bff.api.fetch<Query>(`/engagement/queries/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={`${q.number} · ${q.kind} · ${q.categoryName}`}
        title={q.subject}
        description={`${q.studentName}${q.section ? ` (${q.section})` : ''} · ${q.raisedBy ?? ''} · ${new Date(q.openedAt).toLocaleString('en-IN')}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <Badge
              tone={
                q.status === 'closed' ? 'neutral' : q.status === 'answered' ? 'success' : 'warning'
              }
            >
              {q.status.replace('_', ' ')}
            </Badge>
            {q.decision ? (
              <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>{q.decision}</Badge>
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
          Saved. The family has been notified.
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
            borderLeft: r.isInternal ? '3px solid var(--warning)' : undefined,
          }}
        >
          <div className="ep-kicker">
            {r.author ?? r.authorKind} · {new Date(r.createdAt).toLocaleString('en-IN')}
            {r.isInternal ? ' · internal note' : ''}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
        </Card>
      ))}
      {q.status !== 'closed' ? (
        <Card title="Reply or close" style={{ marginTop: 'var(--sp-3)' }}>
          <form action={respond} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="body"
              rows={4}
              maxLength={4000}
              aria-label="Reply"
              placeholder="Your reply to the family (or a closing note)"
            />
            <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <input type="checkbox" name="isInternal" /> Internal note (hidden from the family)
            </label>
            {q.kind === 'leave' ? (
              <label className="ep-field">
                <span className="ep-field__label">Leave decision (when closing)</span>
                <select className="ep-input" name="decision" defaultValue="approved">
                  <option value="approved">Approve</option>
                  <option value="rejected">Reject</option>
                </select>
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" name="action" value="reply">
                Send reply
              </Button>
              <Button type="submit" name="action" value="close" variant="secondary">
                Close
              </Button>
            </div>
          </form>
        </Card>
      ) : q.rating ? (
        <p className="ep-field__help">The family rated this {q.rating}/5.</p>
      ) : null}
    </main>
  );
}
