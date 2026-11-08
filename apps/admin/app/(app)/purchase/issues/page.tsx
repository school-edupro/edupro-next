import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  inr,
  toIssueGroups,
  type IssueRow,
  type ToIssueGroup,
  type ToIssueResponse,
} from '@/lib/purchase';
import { releaseHold } from '@/lib/purchase-actions';

const TABS = [
  ['to-issue', 'To issue'],
  ['waiting', 'Waiting for acknowledgement'],
  ['mine', 'To acknowledge'],
  ['all', 'All'],
] as const;
type Tab = (typeof TABS)[number][0];
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso));

/**
 * Issues (docs/design/84, part 8): what approved requisitions reserved, still to issue; the issues
 * waiting for the department's acknowledgement; what I am to acknowledge; all issues. A counter issue
 * for a quick need.
 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const keeper = ['purchase.store.operate', 'purchase.store.manage'].some((p) =>
    me.permissions.includes(p),
  );
  const sees = me.permissions.includes('purchase.store.view');
  const tab: Tab = TABS.some(([k]) => k === sp.tab)
    ? (sp.tab as Tab)
    : keeper
      ? 'to-issue'
      : 'mine';
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ page: String(page) });
  if (tab === 'waiting') qs.set('status', 'issued');
  if (tab === 'mine') qs.set('mine', '1');
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const [list, toIssue] = await Promise.all([
    apiFetch<{ rows: IssueRow[]; total: number; toAcknowledge: number }>(
      `/purchase/issues?${qs.toString()}`,
    ),
    keeper && tab === 'to-issue'
      ? apiFetch<ToIssueResponse>('/purchase/to-issue').then((r) => ({
          groups: toIssueGroups(r),
        }))
      : Promise.resolve({ groups: [] as ToIssueGroup[] }),
  ]);
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q: sp.q, ...p })) if (v) u.set(k, v);
    return `/purchase/issues?${u.toString()}`;
  };
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Issues' }]} />
      <PageHeader
        kicker="Purchase"
        title="Issues"
        description="What the stores give out: against what approved requisitions reserved, what came on a goods receipt for an indent, or at the counter. The department acknowledges what it received."
        actions={
          keeper ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/issues/new">
              Counter issue
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav aria-label="Issues to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {TABS.filter(([k]) => (k === 'to-issue' ? keeper : k === 'mine' ? true : sees)).map(
            ([k, l]) => (
              <a
                key={k}
                className="ep-tabs__tab"
                href={link({ tab: k, page: undefined })}
                aria-current={tab === k ? 'page' : undefined}
              >
                {l}
                {k === 'mine' ? ` (${String(list.toAcknowledge)})` : ''}
              </a>
            ),
          )}
        </div>
      </nav>
      {tab === 'to-issue' ? (
        toIssue.groups.length ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {toIssue.groups.map((g) => (
              <section
                key={`${g.indentId ?? g.requisitionId}-${g.storeId}`}
                className="ep-card"
                aria-labelledby={`ti-${g.indentId ?? g.requisitionId}-${g.storeId}`}
              >
                <h2
                  id={`ti-${g.indentId ?? g.requisitionId}-${g.storeId}`}
                  className="ep-card__title"
                >
                  {g.requisition} · {g.department ?? '—'}{' '}
                  {g.indentId ? <Badge tone="info">Indent, from stock</Badge> : null}
                </h2>
                <p style={{ marginTop: 0 }}>
                  From {g.store}
                  {g.indentId ? ` · raised by ${g.raisedBy ?? '—'}` : ''}
                  {g.indents ? ` · for ${g.indents}` : ''}
                  {g.purpose ? ` · ${g.purpose}` : ''}
                </p>
                <ul className="ep-purch-checks">
                  {g.lines.map((l) => (
                    <li key={l.reservationId}>
                      {l.item} ({l.itemCode}): {l.toIssue.toLocaleString('en-IN')} {l.unit} to issue
                      {l.issued ? ` (${l.issued.toLocaleString('en-IN')} issued)` : ''}{' '}
                      {g.indentId ? (
                        <ConfirmAction
                          action={releaseHold}
                          fields={{ reservationId: l.reservationId }}
                          label="Cannot give it"
                          title={`Send ${l.item} on ${g.requisition} to purchase?`}
                          confirmLabel="Send to purchase"
                          variant="ghost"
                          reason={{ label: 'Why the store cannot give it' }}
                        >
                          {`The ${l.toIssue.toLocaleString('en-IN')} ${l.unit} held are let go; the indent waits for a requisition for them (Purchase Requisitions → To requisition).`}
                        </ConfirmAction>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={
                    g.indentId
                      ? `/purchase/issues/new?indent=${g.indentId}&store=${g.storeId}`
                      : `/purchase/issues/new?requisition=${g.requisitionId}&store=${g.storeId}`
                  }
                  aria-label={`Issue ${g.requisition} from ${g.store}`}
                >
                  Issue
                </a>
              </section>
            ))}
          </div>
        ) : (
          <p className="ep-field__help">
            Nothing held for an indent or reserved on a requisition waits to be issued from your
            stores.
          </p>
        )
      ) : (
        <>
          <form method="get" action="/purchase/issues" className="ep-grid__toolbar">
            <input type="hidden" name="tab" value={tab} />
            <label className="ep-field" htmlFor="is-q">
              <span className="ep-field__label">Search</span>
              <input
                id="is-q"
                name="q"
                className="ep-input"
                defaultValue={sp.q ?? ''}
                placeholder="Issue, department, indent or who took it"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Show
            </button>
          </form>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Issues">
            <table className="ep-table">
              <caption className="ep-sr-only">Issues</caption>
              <thead>
                <tr>
                  <th scope="col">Issue</th>
                  <th scope="col">To</th>
                  <th scope="col">From</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Value
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Slip</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.length ? (
                  list.rows.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <a href={`/purchase/issues/${x.id}`}>{x.number}</a>
                        <span className="ep-mr-col__desc">
                          {x.kindLabel} · {when(x.issuedOn)}
                        </span>
                      </td>
                      <td>
                        {x.department}
                        <span className="ep-mr-col__desc">
                          {[x.takenBy, x.indent].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td>{x.store}</td>
                      <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                      <td>
                        <Badge tone={x.status === 'acknowledged' ? 'success' : 'warning'}>
                          {x.status === 'acknowledged'
                            ? 'Acknowledged'
                            : 'Waiting for acknowledgement'}
                        </Badge>
                      </td>
                      <td>
                        <FileLinks
                          href={`/api/purchase/stock-doc/issues/${x.id}`}
                          label={`${x.number} slip as a PDF`}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      {tab === 'mine'
                        ? 'Nothing is waiting for your acknowledgement.'
                        : 'No issues here.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {list.total > 50 ? (
            <p className="ep-field__help">
              Page {page} of {Math.ceil(list.total / 50)} ·{' '}
              {page > 1 ? <a href={link({ page: String(page - 1) })}>Previous</a> : null}{' '}
              {page * 50 < list.total ? <a href={link({ page: String(page + 1) })}>Next</a> : null}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
