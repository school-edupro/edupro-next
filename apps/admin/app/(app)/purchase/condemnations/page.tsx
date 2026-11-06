import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { CONDEMNATION_STATUS, inr, type CondemnationRow } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/**
 * Condemnation (docs/design/84, part 9; GFR 2017 rule 217): proposals of unserviceable, obsolete or
 * surplus assets and stock, through the condemnation committee and the school admin's approval to the
 * write-off and the disposal.
 */
export default async function CondemnationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const manage = me.permissions.includes('purchase.asset.manage');
  const mine = sp.tab === 'mine';
  let data: { rows: CondemnationRow[] };
  try {
    data = await apiFetch<{ rows: CondemnationRow[] }>(
      `/purchase/condemnations${mine ? '?mine=1' : ''}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Purchase', href: '/purchase' }, { label: 'Condemnation' }]} />
      <PageHeader
        kicker="Purchase"
        title="Condemnation"
        description="Assets and stock that are unserviceable, obsolete, surplus or expired: the condemnation committee recommends, the school admin approves and they are written off at their book value, then disposed of — by tender or public auction above ₹2 lakh. Stock on an open proposal is held from issue."
        actions={
          manage ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/purchase/condemnations/new">
              Propose condemnation
            </a>
          ) : null
        }
      />
      <Notice params={sp} />
      <nav
        aria-label="Proposals to show"
        className="ep-tabs"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        <div className="ep-tabs__list">
          <a
            className="ep-tabs__tab"
            href="/purchase/condemnations"
            aria-current={!mine ? 'page' : undefined}
          >
            All
          </a>
          <a
            className="ep-tabs__tab"
            href="/purchase/condemnations?tab=mine"
            aria-current={mine ? 'page' : undefined}
          >
            Waiting for me
          </a>
        </div>
      </nav>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Condemnations">
        <table className="ep-table">
          <caption className="ep-sr-only">Condemnations</caption>
          <thead>
            <tr>
              <th scope="col">Proposal</th>
              <th scope="col">Lines</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Book value
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={`/purchase/condemnations/${x.id}`}>{x.number}</a>
                    <span className="ep-mr-col__desc">
                      {x.title} · {when(x.createdAt)}
                      {x.by ? ` · ${x.by}` : ''}
                    </span>
                  </td>
                  <td>{x.lines}</td>
                  <td style={{ textAlign: 'right' }}>{inr(x.value)}</td>
                  <td>
                    <Badge tone={CONDEMNATION_STATUS[x.status]?.tone ?? 'neutral'}>
                      {CONDEMNATION_STATUS[x.status]?.label ?? x.status}
                    </Badge>
                    {x.status === 'committee' ? (
                      <span className="ep-mr-col__desc">
                        {x.signed} signed{x.toSign ? ' · your signature waits' : ''}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>{mine ? 'Nothing waits for you.' : 'No condemnation yet.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
