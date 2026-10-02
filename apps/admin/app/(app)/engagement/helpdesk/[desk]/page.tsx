import { Badge, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  DESK_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  dueText,
  isDesk,
  when,
  type TicketList,
} from '@/lib/helpdesk';

type Search = {
  status?: string;
  view?: string;
  head?: string;
  q?: string;
  page?: string;
  ok?: string;
  error?: string;
  detail?: string;
};

const INTRO: Record<string, string> = {
  parent:
    "Raised by families in the parent app. Each goes to its owner (usually the child's class teacher); unresolved queries move up the escalation matrix.",
  staff: 'Raised by employees from the teacher app or here: salary, HR, IT, facilities and more.',
  provider:
    'Tickets from school staff to the ERP provider. The provider answers here; late tickets reach the provider’s senior person.',
};

/** One helpdesk desk: tickets with filters, the SLA status and paging. */
export default async function DeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: Promise<Search>;
}) {
  const { desk } = await params;
  if (!isDesk(desk)) notFound();
  const sp = await searchParams;
  const status = sp.status ?? 'active';
  const view = ['all', 'mine', 'assigned'].includes(sp.view ?? '') ? sp.view! : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({ desk, status, view, head: sp.head, q: sp.q?.trim() }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...filters, ...extra }).toString();
  const [me, list, heads] = await Promise.all([
    getMe(),
    apiFetch<TicketList>(`/helpdesk/tickets?${qs({ page: String(page), size: '25' })}`),
    apiFetch<{ data: Array<{ code: string; name: string }> }>(`/helpdesk/heads/${desk}`),
  ]);
  const canRaise = desk !== 'parent' && me.permissions.includes('helpdesk.ticket.raise');
  const count = list.counts.find((c) => c.desk === desk);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  return (
    <>
      <PageHeader
        kicker="Helpdesk"
        title={DESK_LABEL[desk]}
        description={`${INTRO[desk]!} ${count ? `${String(count.open)} open · ${String(count.overdue)} past due.` : ''}`}
        actions={
          canRaise ? (
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href={`/engagement/helpdesk/${desk}/new`}
            >
              {desk === 'provider' ? 'Raise a ticket' : 'Raise a query'}
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <SelectField
            id="hd-status"
            name="status"
            label="Status"
            defaultValue={status}
            options={[
              { value: 'active', label: 'Not closed' },
              { value: 'overdue', label: 'Past due' },
              { value: 'open', label: 'Open' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'answered', label: 'Answered' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
          <SelectField
            id="hd-view"
            name="view"
            label="Show"
            defaultValue={view}
            options={[
              { value: 'all', label: 'Everything I can see' },
              { value: 'assigned', label: 'Assigned to me' },
              { value: 'mine', label: 'Raised by me' },
            ]}
          />
          <SelectField
            id="hd-head"
            name="head"
            label="Query type"
            defaultValue={sp.head ?? ''}
            options={[
              { value: '', label: 'All' },
              ...heads.data.map((h) => ({ value: h.code, label: h.name })),
            ]}
          />
          <label className="ep-field ep-dlog__search" htmlFor="hd-q">
            <span className="ep-field__label">Number, subject, student, admission no. or name</span>
            <input
              id="hd-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={sp.q ?? ''}
              maxLength={80}
            />
          </label>
          <Button type="submit">Show</Button>
        </form>
      </div>
      <Card>
        <p className="ep-field__help" style={{ marginTop: 0 }} aria-live="polite">
          {list.page.total ? `${String(list.page.total)} tickets` : 'No tickets for these filters.'}
        </p>
        {list.data.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={DESK_LABEL[desk]}>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{DESK_LABEL[desk]}</caption>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Subject</th>
                  <th scope="col">{desk === 'parent' ? 'Student' : 'Raised by'}</th>
                  <th scope="col">With</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due</th>
                  <th scope="col">Raised</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <a href={`/engagement/helpdesk/${desk}/${t.id}`}>{t.number}</a>
                    </td>
                    <td>
                      {t.subject}
                      <div className="ep-field__help">
                        {t.head}
                        {desk === 'provider'
                          ? ` · ${PRIORITY_LABEL[t.priority] ?? t.priority}${t.module ? ` · ${t.module}` : ''}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      {desk === 'parent' ? (
                        <>
                          {t.studentName}
                          <div className="ep-field__help">
                            {[t.section, t.admissionNo, t.raisedBy].filter(Boolean).join(' · ')}
                          </div>
                        </>
                      ) : (
                        t.raisedBy
                      )}
                    </td>
                    <td>
                      {t.assignedTo ?? t.assignedRoleName ?? t.assignedRole ?? '—'}
                      {t.level > 1 ? (
                        <div>
                          <Badge tone="danger">Level {t.level}</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      {t.reopenedCount ? <div className="ep-field__help">reopened</div> : null}
                    </td>
                    <td>
                      {t.overdue ? (
                        <Badge tone="danger">{dueText(t)}</Badge>
                      ) : (
                        <span className="ep-field__help">{dueText(t)}</span>
                      )}
                    </td>
                    <td className="ep-field__help">{when(t.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {pages > 1 ? (
          <nav className="ep-grid__pager ep-dlog__pager" aria-label="Pages">
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page - 1) })}`}
              >
                ← Previous
              </a>
            ) : null}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`?${qs({ page: String(page + 1) })}`}
              >
                Next →
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
