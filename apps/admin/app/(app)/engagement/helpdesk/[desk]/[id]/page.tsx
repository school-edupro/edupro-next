import { Alert, Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import {
  DESK_LABEL,
  DESK_ONE,
  EVENT_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  dueText,
  isDesk,
  when,
  type TicketDetail,
} from '@/lib/helpdesk';
import {
  assignTicket,
  closeTicket,
  rateTicket,
  reopenTicket,
  replyTicket,
} from '@/lib/helpdesk-actions';

const OK: Record<string, string> = {
  raised: 'Raised. The owner has been told.',
  replies: 'Reply sent.',
  assign: 'Handed over.',
  close: 'Closed. The person who raised it has been told.',
  reopen: 'Reopened.',
  rate: 'Thank you for rating.',
};

function Files({ ticket, ids, who }: { ticket: string; ids: string[]; who: string }) {
  if (!ids.length) return null;
  return (
    <div className="ep-hd__files">
      {ids.map((f, i) => (
        <FileLinks
          key={f}
          href={`/api/helpdesk/${ticket}/${f}`}
          label={`attachment ${String(i + 1)} from ${who}`}
        />
      ))}
    </div>
  );
}

function FileInput({ id }: { id: string }) {
  return (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">Attachments (optional)</span>
      <input
        id={id}
        name="files"
        type="file"
        className="ep-input"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp"
      />
      <span className="ep-field__help">PDF or images, up to 5 files of 5 MB each.</span>
    </label>
  );
}

/** One helpdesk ticket: the conversation with attachments, the SLA, who has it, and what you can do. */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string; id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { desk, id } = await params;
  if (!isDesk(desk) || !/^\d{1,18}$/.test(id)) notFound();
  const sp = await searchParams;
  const t = await apiFetch<TicketDetail>(`/helpdesk/tickets/${id}`);
  const people = t.you.canAssign
    ? await apiFetch<{
        staff: Array<{ id: string; name: string }>;
        roles: Array<{ code: string; name: string }>;
      }>('/helpdesk/assignees').catch(() => ({ staff: [], roles: [] }))
    : { staff: [], roles: [] };
  const hidden = (
    <>
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="desk" value={t.desk} />
    </>
  );
  const facts: Array<[string, React.ReactNode]> = [
    [
      'Status',
      <Badge key="s" tone={STATUS_TONE[t.status]}>
        {STATUS_LABEL[t.status]}
      </Badge>,
    ],
    [
      'With',
      `${t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? '—'}${t.level > 1 ? ` (level ${String(t.level)})` : ''}`,
    ],
    [
      'Due',
      t.status === 'closed' ? (
        '—'
      ) : (
        <>
          {when(t.dueAt) || '—'}{' '}
          {t.overdue ? (
            <Badge tone="danger">{dueText(t)}</Badge>
          ) : (
            <span className="ep-field__help">{dueText(t)}</span>
          )}
        </>
      ),
    ],
    ...(t.breachedAt
      ? ([
          [
            'SLA',
            <Badge key="b" tone="danger">
              Missed at the last level
            </Badge>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(t.desk === 'provider'
      ? ([
          ['Priority', PRIORITY_LABEL[t.priority] ?? t.priority],
          ['Module', t.module ?? '—'],
          ['Provider status', t.providerStatus ?? '—'],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ...(t.studentName
      ? ([
          [
            'Student',
            `${t.studentName}${t.section ? ` · ${t.section}` : ''}${t.admissionNo ? ` · ${t.admissionNo}` : ''}`,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ['Raised by', t.raisedBy ?? '—'],
    ['Raised', when(t.openedAt)],
    ['First reply', when(t.firstResponseAt) || '—'],
    ...(t.closedAt ? ([['Closed', when(t.closedAt)]] as Array<[string, React.ReactNode]>) : []),
    ...(t.rating
      ? ([
          ['Rating', `${'★'.repeat(t.rating)}${t.ratingComment ? ` · ${t.ratingComment}` : ''}`],
        ] as Array<[string, React.ReactNode]>)
      : []),
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Helpdesk', href: '/engagement/helpdesk' },
          { label: DESK_LABEL[t.desk], href: `/engagement/helpdesk/${t.desk}` },
          { label: t.number },
        ]}
      />
      <PageHeader kicker={`${t.number} · ${DESK_ONE[t.desk]} · ${t.head}`} title={t.subject} />
      {sp.ok ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">{OK[sp.ok] ?? 'Done.'}</Alert>
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-hd__layout">
        <div className="ep-hd__main">
          <Card title="Conversation">
            <ol className="ep-hd__thread">
              <li className="ep-hd__msg ep-hd__msg--raiser">
                <div className="ep-hd__meta">
                  <strong>{t.raisedBy ?? 'Raised'}</strong> · {when(t.openedAt)}
                </div>
                <p className="ep-hd__body">{t.body}</p>
                <Files ticket={t.id} ids={t.fileIds} who={t.raisedBy ?? 'the raiser'} />
              </li>
              {t.replies.map((r) => (
                <li
                  key={r.id}
                  className={`ep-hd__msg ${r.fromRaiser ? 'ep-hd__msg--raiser' : ''} ${r.isInternal ? 'ep-hd__msg--note' : ''}`}
                >
                  <div className="ep-hd__meta">
                    <strong>
                      {r.author ?? (r.authorKind === 'provider' ? 'ERP provider' : 'Staff')}
                    </strong>
                    {r.authorKind === 'provider' ? ' (ERP provider)' : ''} · {when(r.createdAt)}{' '}
                    {r.isInternal ? <Badge tone="neutral">Internal note</Badge> : null}
                  </div>
                  <p className="ep-hd__body">{r.body}</p>
                  <Files ticket={t.id} ids={r.fileIds} who={r.author ?? 'staff'} />
                </li>
              ))}
            </ol>
            {t.resolution && t.status === 'closed' ? (
              <p className="ep-alert ep-alert--success">
                <strong>Resolution:</strong> {t.resolution}
              </p>
            ) : null}
          </Card>
          {t.you.canReply ? (
            <Card title="Reply" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={replyTicket} className="ep-hd__form">
                {hidden}
                <label className="ep-field" htmlFor="r-body">
                  <span className="ep-field__label">Message</span>
                  <textarea
                    id="r-body"
                    name="body"
                    className="ep-input"
                    rows={4}
                    required
                    maxLength={5000}
                  />
                </label>
                <FileInput id="r-files" />
                {t.you.handler && !t.you.raiser ? (
                  <label className="ep-check" htmlFor="r-internal">
                    <input id="r-internal" name="isInternal" type="checkbox" /> Internal note (not
                    shown to the person who raised it)
                  </label>
                ) : null}
                <div>
                  <Button type="submit">Send</Button>
                </div>
              </form>
            </Card>
          ) : null}
          {t.you.canClose ? (
            <Card title="Resolve and close" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={closeTicket} className="ep-hd__form">
                {hidden}
                <label className="ep-field" htmlFor="c-res">
                  <span className="ep-field__label">
                    Resolution (sent to the person who raised it)
                  </span>
                  <textarea
                    id="c-res"
                    name="resolution"
                    className="ep-input"
                    rows={3}
                    required
                    minLength={3}
                    maxLength={5000}
                  />
                </label>
                <FileInput id="c-files" />
                <div>
                  <Button type="submit" variant="secondary">
                    Close as resolved
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
          {t.you.canReopen ? (
            <Card title="Not resolved?" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={reopenTicket} className="ep-hd__form">
                {hidden}
                <label className="ep-field" htmlFor="o-reason">
                  <span className="ep-field__label">
                    Why reopen (until {when(t.you.reopenUntil)})
                  </span>
                  <textarea
                    id="o-reason"
                    name="reason"
                    className="ep-input"
                    rows={3}
                    required
                    minLength={3}
                    maxLength={2000}
                  />
                </label>
                <FileInput id="o-files" />
                <div>
                  <Button type="submit" variant="secondary">
                    Reopen
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
          {t.you.canRate && !t.rating ? (
            <Card title="How was it handled?" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={rateTicket} className="ep-hd__form ep-hd__row">
                {hidden}
                <SelectField
                  id="rating"
                  name="rating"
                  label="Rating"
                  defaultValue="5"
                  options={[5, 4, 3, 2, 1].map((n) => ({
                    value: String(n),
                    label: `${'★'.repeat(n)} (${String(n)})`,
                  }))}
                />
                <label className="ep-field" htmlFor="rate-c">
                  <span className="ep-field__label">Comment (optional)</span>
                  <input id="rate-c" name="comment" className="ep-input" maxLength={500} />
                </label>
                <div>
                  <Button type="submit" variant="secondary">
                    Rate
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
        </div>
        <aside className="ep-hd__side">
          <Card title="Details">
            <dl className="ep-hd__facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {t.you.canAssign ? (
            <Card title="Hand over" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={assignTicket} className="ep-hd__form">
                {hidden}
                <SelectField
                  id="a-to"
                  name="to"
                  label="To an employee or a role"
                  required
                  options={[
                    { value: '', label: 'Choose…' },
                    ...people.roles.map((r) => ({
                      value: `role:${r.code}`,
                      label: `Role: ${r.name}`,
                    })),
                    ...people.staff.map((s) => ({ value: `user:${s.id}`, label: s.name })),
                  ]}
                />
                <label className="ep-field" htmlFor="a-note">
                  <span className="ep-field__label">Note for them (internal)</span>
                  <textarea
                    id="a-note"
                    name="note"
                    className="ep-input"
                    rows={2}
                    maxLength={1000}
                  />
                </label>
                <div>
                  <Button type="submit" variant="secondary">
                    Hand over
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
          <Card title="Timeline" style={{ marginTop: 'var(--sp-4)' }}>
            <ol className="ep-hd__timeline">
              {t.events.map((e, i) => (
                <li key={i}>
                  <span className="ep-hd__tl-what">
                    {EVENT_LABEL[e.kind] ?? e.kind}
                    {e.to ? ` ${e.to}` : ''}
                    {e.kind === 'escalated' && e.level ? ` (level ${String(e.level)})` : ''}
                  </span>
                  <span className="ep-field__help">
                    {when(e.at)}
                    {e.actor && e.kind !== 'escalated' ? ` · ${e.actor}` : ''}
                    {e.emails.length ? ` · mailed ${e.emails.join(', ')}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
