import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  inr,
  type IndentRoute,
  type IndentRow,
  type IndentStatus,
} from '@/lib/purchase';

const VIEWS = {
  waiting: 'Waiting for me',
  mine: 'Raised by me',
  all: 'All I can see',
} as const;
type View = keyof typeof VIEWS;

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '—';

/**
 * Purchase Indents (docs/design/83, part 2): what staff asked for, by department. Waiting for me lists
 * those at my approval level (or a colleague's who handed theirs to me); the purchase office sees every
 * department's and the approved ones waiting for the PR or, the PR skipped by a rule, for the PO.
 */
export default async function IndentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canRaise = me.permissions.includes('purchase.indent.raise');
  const seeAll = me.permissions.includes('purchase.indent.view');
  if (!canRaise && !seeAll) notFound();
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : 'all';
  const status = sp.status && sp.status in INDENT_STATUS ? (sp.status as IndentStatus) : undefined;
  const route = sp.route && sp.route in INDENT_ROUTE ? (sp.route as IndentRoute) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ view, page: String(page), size: '50' });
  if (status) qs.set('status', status);
  if (route) qs.set('route', route);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const data = await apiFetch<{ data: IndentRow[]; total: number; waitingForMe: number }>(
    `/purchase/indents?${qs.toString()}`,
  );
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, status, route, q: sp.q, ...p }))
      if (v && !(k === 'view' && v === 'all')) u.set(k, v);
    const s = u.toString();
    return `/purchase/indents${s ? `?${s}` : ''}`;
  };
  return (
    <>
      <Breadcrumbs
        items={[
          ...(me.permissions.includes('purchase.master.view')
            ? [{ label: 'Purchase', href: '/purchase' }]
            : []),
          { label: 'Purchase Indents' },
        ]}
      />
      <PageHeader
        kicker="Purchase"
        title="Purchase Indents"
        description="Ask for what your department needs. The department’s approvers decide in turn — nobody approves their own — and an approved indent goes to the purchase office’s requisition, or straight to the order when a rule allows it."
        actions={
          canRaise ? (
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href="/purchase/indents/new"
              style={{ whiteSpace: 'nowrap' }}
            >
              Raise an indent
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav aria-label="Indents to show" className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <a
              key={v}
              className="ep-tabs__tab"
              href={link({ view: v, status: undefined, route: undefined })}
              aria-current={view === v ? 'page' : undefined}
            >
              {VIEWS[v]}
              {v === 'waiting' ? ` (${String(data.waitingForMe)})` : ''}
            </a>
          ))}
          {seeAll ? (
            <>
              <a
                className="ep-tabs__tab"
                href={link({ view: 'all', status: 'approved', route: 'to_requisition' })}
                aria-current={route === 'to_requisition' ? 'page' : undefined}
              >
                Waiting for the PR
              </a>
              <a
                className="ep-tabs__tab"
                href={link({ view: 'all', status: 'approved', route: 'to_order' })}
                aria-current={route === 'to_order' ? 'page' : undefined}
              >
                PR skipped: for the PO
              </a>
            </>
          ) : null}
        </div>
      </nav>
      <form method="get" action="/purchase/indents" className="ep-grid__toolbar">
        {view !== 'all' ? <input type="hidden" name="view" value={view} /> : null}
        {route ? <input type="hidden" name="route" value={route} /> : null}
        <label className="ep-field" htmlFor="pi-status">
          <span className="ep-field__label">Status</span>
          <select id="pi-status" name="status" className="ep-select" defaultValue={status ?? ''}>
            <option value="">Any</option>
            {(Object.keys(INDENT_STATUS) as IndentStatus[]).map((s) => (
              <option key={s} value={s}>
                {INDENT_STATUS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="pi-q">
          <span className="ep-field__label">Search</span>
          <input
            id="pi-q"
            name="q"
            className="ep-input"
            defaultValue={sp.q ?? ''}
            placeholder="Number or purpose"
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
          Show
        </button>
      </form>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Purchase Indents">
        <table className="ep-table">
          <caption className="ep-sr-only">Purchase Indents</caption>
          <thead>
            <tr>
              <th scope="col">Indent</th>
              <th scope="col">Department</th>
              <th scope="col">Raised by</th>
              <th scope="col">Needed by</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Estimate
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/indents/${x.id}`}>{x.number ?? 'Draft'}</a>
                    {x.priority === 'urgent' ? (
                      <>
                        {' '}
                        <Badge tone="danger">Urgent</Badge>
                      </>
                    ) : null}
                    <span className="ep-mr-col__desc">
                      {x.purpose.length > 80 ? `${x.purpose.slice(0, 80)}…` : x.purpose} · {x.lines}{' '}
                      {x.lines === 1 ? 'line' : 'lines'}
                    </span>
                  </td>
                  <td>{x.department}</td>
                  <td>
                    {x.raisedBy}
                    {x.onBehalf ? <span className="ep-mr-col__desc">for {x.onBehalf}</span> : null}
                  </td>
                  <td>{x.requiredBy ? when(`${x.requiredBy}T00:00:00+05:30`) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.estimate)}</td>
                  <td>
                    <Badge tone={INDENT_STATUS[x.status].tone}>
                      {INDENT_STATUS[x.status].label}
                    </Badge>
                    <span className="ep-mr-col__desc">
                      {x.status === 'submitted' && x.waitingWith
                        ? `With ${x.waitingWith}`
                        : x.status === 'approved' && x.route
                          ? INDENT_ROUTE[x.route]
                          : x.decidedAt
                            ? when(x.decidedAt)
                            : x.submittedAt
                              ? when(x.submittedAt)
                              : `Started ${when(x.createdAt)}`}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  {view === 'waiting'
                    ? 'Nothing is waiting for your approval.'
                    : 'No indents here yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.total > 50 ? (
        <p className="ep-field__help">
          Page {page} of {Math.ceil(data.total / 50)} ·{' '}
          {page > 1 ? <a href={link({ page: String(page - 1) })}>Previous</a> : null}{' '}
          {page * 50 < data.total ? <a href={link({ page: String(page + 1) })}>Next</a> : null}
        </p>
      ) : null}
    </>
  );
}
