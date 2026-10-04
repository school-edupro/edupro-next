import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import {
  STATUS_LABEL,
  STATUS_TONE,
  approvalLine,
  monthLabel,
  rideLines,
  rupees,
  whoLine,
  type TransportRequest,
} from '@/lib/transport-desk';

interface RequestList {
  data: TransportRequest[];
  page: { number: number; size: number; total: number };
  counts: { pending: number; approved: number; rejected: number };
}
const TABS = ['pending', 'approved', 'rejected', 'all'] as const;
type Tab = (typeof TABS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The transport requests of the session: new transport, changes and withdrawals, from families and from
 * the transport office, each with where its approval stands. Filters, pages and Excel.
 */
export default async function TransportRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    source?: string;
    kind?: string;
    routeId?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'pending';
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(
    Object.entries({
      tab,
      source: ['parent', 'office'].includes(sp.source ?? '') ? sp.source : undefined,
      kind: ['join', 'change', 'leave'].includes(sp.kind ?? '') ? sp.kind : undefined,
      routeId: /^\d+$/.test(sp.routeId ?? '') ? sp.routeId : undefined,
      from: DATE.test(sp.from ?? '') ? sp.from : undefined,
      to: DATE.test(sp.to ?? '') ? sp.to : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ ...filters, ...extra }).toString();
  const [me, list, routes] = await Promise.all([
    getMe(),
    apiFetch<RequestList>(`/transport/requests?${qs({ page: String(page) })}`),
    apiFetch<{ data: Array<{ id: string; code: string; name: string }> }>('/transport/routes')
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const pages = Math.max(1, Math.ceil(list.page.total / list.page.size));
  const tabs: Array<[Tab, string, number | null]> = [
    ['pending', 'Waiting for approval', list.counts.pending],
    ['approved', 'Approved', list.counts.approved],
    ['rejected', 'Not approved', list.counts.rejected],
    ['all', 'Everything', null],
  ];
  const filtered = Object.keys(filters).length > 1;
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Transport requests"
        description="New transport, changes and withdrawals. A family’s request goes to the transport in-charge and then the fee department; one made here goes to the fee department."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/transport/requests?${qs()}`}
            >
              Excel
            </a>
            {me.permissions.includes('transport.request.apply') ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/transport/requests/new">
                Apply for a student
              </a>
            ) : null}
          </span>
        }
      />
      <TransportNav current="/transport/requests" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/transport/requests?tab=${value}`}
            aria-current={tab === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="tab" value={tab} />
          <SelectField
            id="tr-kind"
            name="kind"
            label="Type"
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: 'All types' },
              { value: 'join', label: 'New transport' },
              { value: 'change', label: 'Change' },
              { value: 'leave', label: 'Withdrawal' },
            ]}
          />
          <SelectField
            id="tr-source"
            name="source"
            label="Made by"
            defaultValue={filters.source ?? ''}
            options={[
              { value: '', label: 'Family and office' },
              { value: 'parent', label: 'Family (portal)' },
              { value: 'office', label: 'Transport office' },
            ]}
          />
          <SelectField
            id="tr-route"
            name="routeId"
            label="Route"
            defaultValue={filters.routeId ?? ''}
            options={[
              { value: '', label: 'All routes' },
              ...routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
            ]}
          />
          <label className="ep-field" htmlFor="tr-from">
            <span className="ep-field__label">Asked from</span>
            <input
              id="tr-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={filters.from ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor="tr-to">
            <span className="ep-field__label">To</span>
            <input
              id="tr-to"
              name="to"
              type="date"
              className="ep-input"
              defaultValue={filters.to ?? ''}
            />
          </label>
          <InputField
            id="tr-q"
            name="q"
            type="search"
            label="Request no., name, admission no. or route"
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href={`/transport/requests?tab=${tab}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {filtered ? 'Nothing matches these filters.' : 'Nothing here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Transport requests">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Transport requests, latest first</caption>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Student</th>
                  <th scope="col">Service and stoppage</th>
                  <th scope="col">Months</th>
                  <th scope="col" className="ep-num">
                    Monthly
                  </th>
                  <th scope="col">Asked</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.number}
                      <div className="ep-field__help">{r.kindLabel}</div>
                    </td>
                    <td>
                      {r.student}
                      <div className="ep-field__help">{whoLine(r)}</div>
                    </td>
                    <td>
                      {r.kind === 'leave' ? 'Stop the transport' : r.serviceLabel}
                      {rideLines(r).map((l) => (
                        <div key={l} className="ep-field__help">
                          {l}
                        </div>
                      ))}
                    </td>
                    <td>
                      {r.kind === 'leave'
                        ? `From ${monthLabel(r.fromMonth)}`
                        : `${monthLabel(r.fromMonth)} – ${monthLabel(r.toMonth)}`}
                    </td>
                    <td className="ep-num">
                      {r.kind === 'leave' ? '—' : rupees(r.monthlyAmount)}
                      {r.slab ? <div className="ep-field__help">{r.slab}</div> : null}
                    </td>
                    <td>
                      {when(r.requestedAt)}
                      <div className="ep-field__help">
                        {r.source === 'office' ? 'Transport office' : 'Family'}
                        {r.requestedBy ? ` · ${r.requestedBy}` : ''}
                      </div>
                    </td>
                    <td>{approvalLine(r)}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/transport/requests/${r.id}`}
                        aria-label={`Open ${r.number}`}
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pages > 1 ? (
        <nav
          aria-label="Pages"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            marginTop: 'var(--sp-3)',
          }}
        >
          {page > 1 ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page - 1) })}`}
            >
              ← Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages} · {String(list.page.total)} in all
          </span>
          {page < pages ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`?${qs({ page: String(page + 1) })}`}
            >
              Next →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
