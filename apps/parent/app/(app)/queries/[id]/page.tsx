import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { FileLinks } from '@/components/FileLinks';
import { rateQuery, reopenQuery, replyToQuery } from '../actions';

interface Query {
  id: string;
  number: string;
  kind: 'query' | 'complaint' | 'leave';
  categoryName: string;
  studentName: string;
  subject: string;
  body: string;
  fileIds: string[];
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
    fileIds: string[];
    createdAt: string;
  }>;
}

/** Helpdesk flags for a query (not for leave): reopen window, resolution, level. */
interface Helpdesk {
  resolution: string | null;
  level: number;
  you: { canReopen: boolean; reopenUntil: string | null };
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
  const lang = await currentLang();
  let q: Query;
  try {
    q = await bff.api.fetch<Query>(`/engagement/mine/queries/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) redirect('/queries?error=not-found');
    throw error;
  }
  const hd =
    q.kind === 'leave'
      ? null
      : await bff.api.fetch<Helpdesk>(`/engagement/mine/queries/${id}/timeline`).catch(() => null);
  const files = (ids: string[], who: string) =>
    ids.length ? (
      <div
        style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', flexWrap: 'wrap' }}
      >
        {ids.map((f, i) => (
          <FileLinks
            key={f}
            url={`/api/attachment/query/${q.id}/${f}`}
            saveUrl={`/api/attachment/query/${q.id}/${f}?save=1`}
            label={`${t(lang, 'attachment')} ${String(i + 1)} · ${who}`}
            viewLabel={t(lang, 'View')}
            saveLabel={t(lang, 'Download')}
          />
        ))}
      </div>
    ) : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={`${q.number} · ${q.categoryName}`}
        title={q.subject}
        description={`${q.studentName} · ${t(lang, 'opened')} ${new Date(q.openedAt).toLocaleDateString('en-IN')}${q.assignedTo ? ` · ${t(lang, 'handled by')} ${q.assignedTo}` : ''}`}
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
              {t(lang, LABEL[q.status])}
            </Badge>
            {q.decision ? (
              <Badge tone={q.decision === 'approved' ? 'success' : 'danger'}>
                {t(lang, 'Leave')} {t(lang, q.decision)}
              </Badge>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/queries">
              {t(lang, 'Back')}
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
          {t(lang, 'Saved.')}
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
        {files(q.fileIds ?? [], t(lang, 'You'))}
        {q.kind === 'leave' ? (
          <p className="ep-kicker" style={{ marginTop: 'var(--sp-2)' }}>
            {t(lang, 'Leave')} {q.leaveFrom} → {q.leaveTo}
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
            {r.authorKind === 'staff' ? (r.author ?? t(lang, 'School')) : t(lang, 'You')} ·{' '}
            {new Date(r.createdAt).toLocaleString('en-IN')}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
          {files(
            r.fileIds ?? [],
            r.authorKind === 'staff' ? (r.author ?? t(lang, 'School')) : t(lang, 'You'),
          )}
        </Card>
      ))}
      {q.status !== 'closed' ? (
        <Card title={t(lang, 'Reply')} style={{ marginTop: 'var(--sp-3)' }}>
          <form action={replyToQuery} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="body"
              rows={3}
              required
              maxLength={4000}
              aria-label={t(lang, 'Reply')}
            />
            <label className="ep-field">
              <span className="ep-field__label">{t(lang, 'Attachments (optional)')}</span>
              <input
                className="ep-input"
                type="file"
                name="files"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
            </label>
            <div>
              <Button type="submit">{t(lang, 'Send')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {hd?.resolution && q.status === 'closed' ? (
        <div className="ep-alert ep-alert--success" style={{ marginTop: 'var(--sp-3)' }}>
          <strong>{t(lang, 'Resolution')}:</strong> {hd.resolution}
        </div>
      ) : null}
      {hd?.you.canReopen ? (
        <Card title={t(lang, 'Not resolved?')} style={{ marginTop: 'var(--sp-3)' }}>
          <form action={reopenQuery} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <label className="ep-field">
              <span className="ep-field__label">{t(lang, 'Why are you reopening it?')}</span>
              <textarea
                className="ep-input"
                name="reason"
                rows={3}
                required
                minLength={3}
                maxLength={2000}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">{t(lang, 'Attachments (optional)')}</span>
              <input
                className="ep-input"
                type="file"
                name="files"
                multiple
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
            </label>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {t(lang, 'You can reopen it until')}{' '}
              {hd.you.reopenUntil ? new Date(hd.you.reopenUntil).toLocaleDateString('en-IN') : ''}
            </p>
            <div>
              <Button type="submit" variant="secondary">
                {t(lang, 'Reopen')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {['answered', 'closed'].includes(q.status) && !q.rating ? (
        <Card title={t(lang, 'How was this handled?')} style={{ marginTop: 'var(--sp-3)' }}>
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
              placeholder={t(lang, 'Comment (optional)')}
              maxLength={500}
              aria-label={t(lang, 'Comment')}
            />
            <div>
              <Button type="submit" variant="secondary">
                {t(lang, 'Rate')}
              </Button>
            </div>
          </form>
        </Card>
      ) : q.rating ? (
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
          {t(lang, 'You rated this')} {q.rating}/5
          {q.ratingComment ? ` · ${q.ratingComment}` : ''}.
        </p>
      ) : null}
    </main>
  );
}
