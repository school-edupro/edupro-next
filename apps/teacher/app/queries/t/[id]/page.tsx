import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { close, handOver, rate, reopen, reply } from '../../helpdesk-actions';

type Status = 'open' | 'in_progress' | 'answered' | 'closed';
interface Detail {
  id: string;
  number: string;
  desk: 'parent' | 'staff' | 'provider';
  head: string;
  studentName: string | null;
  section: string | null;
  admissionNo: string | null;
  raisedBy: string | null;
  subject: string;
  body: string;
  fileIds: string[];
  status: Status;
  priority: string;
  level: number;
  dueAt: string | null;
  overdue: boolean;
  assignedTo: string | null;
  assignedRoleName: string | null;
  resolution: string | null;
  rating: number | null;
  openedAt: string;
  replies: Array<{
    id: string;
    author: string | null;
    authorKind: string;
    fromRaiser: boolean;
    body: string;
    fileIds: string[];
    isInternal: boolean;
    createdAt: string;
  }>;
  events: Array<{
    kind: string;
    level: number | null;
    at: string;
    actor: string | null;
    to: string | null;
  }>;
  you: {
    handler: boolean;
    raiser: boolean;
    canReply: boolean;
    canAssign: boolean;
    canClose: boolean;
    canReopen: boolean;
    canRate: boolean;
    reopenUntil: string | null;
  };
}
const LABEL: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  closed: 'Closed',
};
const EVENT: Record<string, string> = {
  created: 'Raised, sent to',
  assigned: 'Handed to',
  replied: 'Reply',
  note: 'Internal note',
  escalated: 'Escalated to',
  breached: 'Time limit missed',
  closed: 'Closed',
  reopened: 'Reopened',
  rated: 'Rated',
};
const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/** One helpdesk ticket in the teacher app: answer with files, hand over, close; or follow your own. */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await currentLang();
  let q: Detail;
  try {
    q = await bff.api.fetch<Detail>(`/helpdesk/tickets/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) redirect('/queries');
    throw error;
  }
  const people = q.you.canAssign
    ? await bff.api
        .fetch<{
          staff: Array<{ id: string; name: string }>;
          roles: Array<{ code: string; name: string }>;
        }>('/helpdesk/assignees')
        .catch(() => ({ staff: [], roles: [] }))
    : { staff: [], roles: [] };
  const files = (ids: string[], who: string) =>
    ids.length ? (
      <div
        style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}
      >
        {ids.map((f, i) => (
          <FileLinks
            key={f}
            url={`/api/helpdesk/${q.id}/${f}`}
            saveUrl={`/api/helpdesk/${q.id}/${f}?save=1`}
            label={`${t(lang, 'attachment')} ${String(i + 1)} · ${who}`}
          />
        ))}
      </div>
    ) : null;
  const fileInput = (key: string) => (
    <label className="ep-field" htmlFor={`f-${key}`}>
      <span className="ep-field__label">{t(lang, 'Attachments (optional)')}</span>
      <input
        id={`f-${key}`}
        className="ep-input"
        type="file"
        name="files"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp"
      />
    </label>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 760, margin: '0 auto' }}>
      <PageHeader
        kicker={`${q.number} · ${q.head}`}
        title={q.subject}
        description={[
          q.studentName
            ? `${q.studentName}${q.section ? ` (${q.section})` : ''}${q.admissionNo ? ` · ${q.admissionNo}` : ''}`
            : null,
          `${t(lang, 'Raised by')} ${q.raisedBy ?? ''} · ${when(q.openedAt)}`,
          `${t(lang, 'With')} ${q.assignedTo ?? q.assignedRoleName ?? '—'}${q.level > 1 ? ` (${t(lang, 'Level')} ${String(q.level)})` : ''}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            {q.overdue ? <Badge tone="danger">{t(lang, 'Past due')}</Badge> : null}
            <Badge
              tone={
                q.status === 'closed' ? 'neutral' : q.status === 'answered' ? 'success' : 'warning'
              }
            >
              {t(lang, LABEL[q.status])}
            </Badge>
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
        <div className="ep-kicker">
          {q.raisedBy} · {when(q.openedAt)}
        </div>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{q.body}</p>
        {files(q.fileIds, q.raisedBy ?? '')}
      </Card>
      {q.replies.map((r) => (
        <Card
          key={r.id}
          elevated
          style={{ marginBottom: 'var(--sp-2)', marginLeft: r.fromRaiser ? 0 : 'var(--sp-5)' }}
        >
          <div className="ep-kicker">
            {r.author ?? (r.authorKind === 'provider' ? 'ERP provider' : '')} · {when(r.createdAt)}{' '}
            {r.isInternal ? <Badge tone="neutral">{t(lang, 'Internal note')}</Badge> : null}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
          {files(r.fileIds, r.author ?? '')}
        </Card>
      ))}
      {q.resolution && q.status === 'closed' ? (
        <div className="ep-alert ep-alert--success" style={{ marginTop: 'var(--sp-3)' }}>
          <strong>{t(lang, 'Resolution')}:</strong> {q.resolution}
        </div>
      ) : null}
      {q.you.canReply ? (
        <Card title={t(lang, 'Reply')} style={{ marginTop: 'var(--sp-3)' }}>
          <form action={reply} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="body"
              rows={3}
              required
              maxLength={5000}
              aria-label={t(lang, 'Reply')}
            />
            {fileInput('reply')}
            {q.you.handler && !q.you.raiser ? (
              <label style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                <input type="checkbox" name="isInternal" />{' '}
                {t(lang, 'Internal note (not shown to the person who raised it)')}
              </label>
            ) : null}
            <div>
              <Button type="submit">{t(lang, 'Send')}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {q.you.canClose ? (
        <Card title={t(lang, 'Resolve and close')} style={{ marginTop: 'var(--sp-3)' }}>
          <form action={close} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="resolution"
              rows={3}
              required
              minLength={3}
              maxLength={5000}
              aria-label={t(lang, 'Resolution')}
              placeholder={t(lang, 'How it was resolved (sent to the person who raised it)')}
            />
            {fileInput('close')}
            <div>
              <Button type="submit" variant="secondary">
                {t(lang, 'Close as resolved')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {q.you.canAssign ? (
        <Card
          title={t(lang, 'Cannot resolve it? Hand it over')}
          style={{ marginTop: 'var(--sp-3)' }}
        >
          <form action={handOver} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <label className="ep-field" htmlFor="to">
              <span className="ep-field__label">{t(lang, 'To an employee or a role')}</span>
              <select id="to" name="to" className="ep-select" required defaultValue="">
                <option value="">{t(lang, 'Choose…')}</option>
                {people.roles.map((r) => (
                  <option key={r.code} value={`role:${r.code}`}>
                    {t(lang, 'Role')}: {r.name}
                  </option>
                ))}
                {people.staff.map((s) => (
                  <option key={s.id} value={`user:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              className="ep-input"
              name="note"
              rows={2}
              maxLength={1000}
              aria-label={t(lang, 'Note')}
              placeholder={t(lang, 'Note for them (internal)')}
            />
            <div>
              <Button type="submit" variant="secondary">
                {t(lang, 'Hand over')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {q.you.canReopen ? (
        <Card title={t(lang, 'Not resolved?')} style={{ marginTop: 'var(--sp-3)' }}>
          <form action={reopen} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={q.id} />
            <textarea
              className="ep-input"
              name="reason"
              rows={3}
              required
              minLength={3}
              maxLength={2000}
              aria-label={t(lang, 'Why are you reopening it?')}
              placeholder={t(lang, 'Why are you reopening it?')}
            />
            {fileInput('reopen')}
            <div>
              <Button type="submit" variant="secondary">
                {t(lang, 'Reopen')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {q.you.canRate && !q.rating ? (
        <Card title={t(lang, 'How was this handled?')} style={{ marginTop: 'var(--sp-3)' }}>
          <form
            action={rate}
            style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input type="hidden" name="id" value={q.id} />
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="radio" name="rating" value={n} defaultChecked={n === 5} /> {n}
              </label>
            ))}
            <Button type="submit" variant="secondary">
              {t(lang, 'Rate')}
            </Button>
          </form>
        </Card>
      ) : null}
      <Card title={t(lang, 'Timeline')} style={{ marginTop: 'var(--sp-3)' }}>
        <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
          {q.events.map((e, i) => (
            <li key={i}>
              {t(lang, EVENT[e.kind] ?? e.kind)}
              {e.to ? ` ${e.to}` : ''} <span className="ep-field__help">· {when(e.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
