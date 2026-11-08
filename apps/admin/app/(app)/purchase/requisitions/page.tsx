import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import {
  ExportButtons,
  ListFilterFields,
  readListFilters,
} from '@/components/purchase/ListFilters';
import { apiFetch, getMe } from '@/lib/api';
import {
  inr,
  REQUISITION_STATUS,
  TIER,
  type RequisitionRow,
  type RequisitionStatus,
} from '@/lib/purchase';

const VIEWS = { all: 'All', waiting: 'Waiting for me', sign: 'To sign' } as const;
type View = keyof typeof VIEWS;
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * Purchase Requisitions (docs/design/83, part 3): the purchase office's list (from approved indents, or
 * direct), the ones waiting for my approval, and the comparative statements waiting for my signature
 * (the purchase committee).
 */
export default async function RequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('purchase.requisition.manage');
  // a direct requisition (not from indents) is the purchase office's (docs/design/83)
  const direct = me.permissions.includes('purchase.requisition.direct');
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : manage ? 'all' : 'waiting';
  const status =
    sp.status && sp.status in REQUISITION_STATUS ? (sp.status as RequisitionStatus) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = new URLSearchParams({ view, page: String(page), size: '50' });
  if (status) qs.set('status', status);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  // department, dates, the indent it came from, the vendor (docs/design/83, list filters)
  const f = readListFilters(sp, true);
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  const [data, choices] = await Promise.all([
    apiFetch<{
      data: RequisitionRow[];
      total: number;
      waitingForMe: number;
      toSign: number;
      toRequisition: number;
    }>(`/purchase/requisitions?${qs.toString()}`),
    apiFetch<{
      departments: Array<{ id: string; name: string }>;
      vendors: Array<{ id: string; code: string; name: string }>;
    }>('/purchase/list-filters'),
  ]);
  if (!manage && !data.total && !data.waitingForMe && !data.toSign && view === 'all') notFound();
  const link = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, status, q: sp.q, ...f, ...p })) if (v) u.set(k, v);
    return `/purchase/requisitions?${u.toString()}`;
  };
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Purchase Requisitions' }]}
      />
      <PageHeader
        kicker="Purchase"
        title="Purchase Requisitions"
        description="The purchase office turns approved indents into requisitions, sources each by its value — direct purchase, the purchase committee’s quotes, or a tender — and sends it to the department’s approvers."
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <ExportButtons
              doc="requisitions"
              params={{ view, status, q: sp.q?.slice(0, 80), ...f }}
            />
            {manage ? (
              <>
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href="/purchase/to-requisition"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  To requisition ({data.toRequisition})
                </a>
                {direct ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href="/purchase/requisitions/new"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Direct requisition
                  </a>
                ) : null}
              </>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />
      <nav
        aria-label="Requisitions to show"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <a
              key={v}
              className="ep-tabs__tab"
              href={link({ view: v, status: undefined, page: undefined })}
              aria-current={view === v ? 'page' : undefined}
            >
              {VIEWS[v]}
              {v === 'waiting' ? ` (${String(data.waitingForMe)})` : ''}
              {v === 'sign' ? ` (${String(data.toSign)})` : ''}
            </a>
          ))}
        </div>
      </nav>
      {view === 'all' ? (
        <form method="get" action="/purchase/requisitions" className="ep-grid__toolbar">
          <label className="ep-field" htmlFor="pr-status">
            <span className="ep-field__label">Status</span>
            <select id="pr-status" name="status" className="ep-select" defaultValue={status ?? ''}>
              <option value="">Any</option>
              {(Object.keys(REQUISITION_STATUS) as RequisitionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {REQUISITION_STATUS[s].label}
                </option>
              ))}
            </select>
          </label>
          <ListFilterFields
            prefix="pr"
            values={f}
            departments={choices.departments}
            vendors={choices.vendors}
            withIndent
          />
          <label className="ep-field" htmlFor="pr-q">
            <span className="ep-field__label">Search</span>
            <input
              id="pr-q"
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
      ) : null}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Purchase Requisitions">
        <table className="ep-table">
          <caption className="ep-sr-only">Purchase Requisitions</caption>
          <thead>
            <tr>
              <th scope="col">Requisition</th>
              <th scope="col">Department</th>
              <th scope="col">Sourcing</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.data.length ? (
              data.data.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/requisitions/${x.id}`}>{x.number}</a>
                    <span className="ep-mr-col__desc">
                      {x.purpose ?? ''} · {x.lines} {x.lines === 1 ? 'line' : 'lines'}
                    </span>
                  </td>
                  <td>
                    {x.department ?? '—'}
                    {x.combined ? <span className="ep-mr-col__desc">combined</span> : null}
                  </td>
                  <td>
                    {x.autoRule ? 'Approved by the system' : x.tier ? TIER[x.tier].label : '—'}
                    {x.quotes ? (
                      <span className="ep-mr-col__desc">
                        {x.quotes} {x.quotes === 1 ? 'quote' : 'quotes'}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{inr(x.estimate)}</td>
                  <td>
                    <Badge tone={REQUISITION_STATUS[x.status].tone}>
                      {REQUISITION_STATUS[x.status].label}
                    </Badge>
                    <span className="ep-mr-col__desc">
                      {x.status === 'submitted' && x.waitingWith
                        ? `With ${x.waitingWith}`
                        : when(x.decidedAt ?? x.submittedAt ?? x.createdAt)}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>
                  {view === 'waiting'
                    ? 'Nothing is waiting for your approval.'
                    : view === 'sign'
                      ? 'No comparative statement waits for your signature.'
                      : 'No requisitions yet.'}
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
