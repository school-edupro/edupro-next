import { Badge, DataTable, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { DueIssues } from '@/components/library/Periodicals';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  SUBSCRIPTION_STATE,
  SUBSCRIPTION_TONE,
  dmy,
  type DueIssue,
  type SubscriptionList,
  type SubscriptionRow,
  type SubscriptionSetup,
} from '@/lib/library-books';

const STATES = [
  ['current', 'Current'],
  ['ending', 'Ending in 30 days'],
  ['upcoming', 'Not started'],
  ['ended', 'Ended'],
  ['cancelled', 'Cancelled'],
  ['all', 'All'],
] as const;
const inr = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * Periodicals (docs/design/36-library.md, part 6): the issues to receive (the morning's check-in, late
 * first) and the subscriptions with their issues so far; the late and missing issues to claim.
 */
export default async function PeriodicalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    status?: string;
    library?: string;
    q?: string;
    ahead?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('library.catalogue.view')) notFound();
  const tab = sp.tab === 'subscriptions' ? 'subscriptions' : 'receive';
  const status = STATES.some(([k]) => k === sp.status) ? sp.status! : 'current';
  const library = sp.library && /^\d{1,18}$/.test(sp.library) ? sp.library : '';
  const ahead = sp.ahead === '7' ? '7' : '0';
  const qs = new URLSearchParams({ status });
  if (library) qs.set('libraryId', library);
  if (sp.q) qs.set('q', sp.q.slice(0, 80));
  const [setup, list, due] = await Promise.all([
    apiFetch<SubscriptionSetup>('/library/subscriptions/setup'),
    apiFetch<SubscriptionList>(`/library/subscriptions?${qs.toString()}`),
    tab === 'receive'
      ? apiFetch<{ data: DueIssue[] }>(
          `/library/issues/due?ahead=${ahead}${library ? `&libraryId=${library}` : ''}`,
        )
      : null,
  ]);
  const f = list.figures;
  return (
    <>
      <PageHeader
        kicker="Library"
        title="Periodicals"
        description="Newspapers, magazines and journals the library takes: the issues to receive, the subscriptions and what to claim from the vendors."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {list.can.manage ? (
              <a className="ep-btn ep-btn--primary" href="/library/periodicals/new">
                + Subscribe
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary" href="/api/library-claims">
              Issues to claim (Excel)
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {(
          [
            ['To receive', f.toReceive, '/library/periodicals'],
            ['Late', f.late, '/library/periodicals'],
            ['Current subscriptions', f.current, '/library/periodicals?tab=subscriptions'],
            ['Ending in 30 days', f.ending, '/library/periodicals?tab=subscriptions&status=ending'],
          ] as const
        ).map(([label, n, href]) => (
          <a key={label} className="ep-card ep-card--elevated ep-staff-kpi" href={href}>
            <span className="ep-kpi__value">{n}</span>
            <span className="ep-kpi__label">{label}</span>
          </a>
        ))}
        <div className="ep-card ep-card--elevated ep-staff-kpi">
          <span className="ep-kpi__value">{inr(f.cost)}</span>
          <span className="ep-kpi__label">Cost of the current</span>
        </div>
      </div>
      <nav className="ep-tabs" aria-label="Periodicals" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="ep-tabs__list">
          <a
            className="ep-tabs__tab"
            href="/library/periodicals"
            aria-current={tab === 'receive' ? 'page' : undefined}
          >
            To receive
          </a>
          <a
            className="ep-tabs__tab"
            href="/library/periodicals?tab=subscriptions"
            aria-current={tab === 'subscriptions' ? 'page' : undefined}
          >
            Subscriptions
          </a>
        </div>
      </nav>
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        {tab === 'subscriptions' ? <input type="hidden" name="tab" value="subscriptions" /> : null}
        <label className="ep-field" htmlFor="pd-library" style={{ margin: 0 }}>
          <span className="ep-field__label">Library</span>
          <select id="pd-library" name="library" className="ep-select" defaultValue={library}>
            <option value="">All</option>
            {setup.libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {tab === 'subscriptions' ? (
          <>
            <label className="ep-field" htmlFor="pd-status" style={{ margin: 0 }}>
              <span className="ep-field__label">Subscriptions</span>
              <select id="pd-status" name="status" className="ep-select" defaultValue={status}>
                {STATES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="pd-q" style={{ margin: 0 }}>
              <span className="ep-field__label">Periodical</span>
              <input
                id="pd-q"
                name="q"
                type="search"
                className="ep-input"
                maxLength={80}
                defaultValue={sp.q ?? ''}
              />
            </label>
          </>
        ) : (
          <label className="ep-field" htmlFor="pd-ahead" style={{ margin: 0 }}>
            <span className="ep-field__label">Expected</span>
            <select id="pd-ahead" name="ahead" className="ep-select" defaultValue={ahead}>
              <option value="0">By today</option>
              <option value="7">By today and the next 7 days</option>
            </select>
          </label>
        )}
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      {tab === 'receive' && due ? (
        <DueIssues issues={due.data} manage={list.can.manage} />
      ) : (
        <DataTable<SubscriptionRow>
          caption="Subscriptions"
          density="dense"
          emptyTitle="No subscription here"
          columns={[
            {
              key: 'p',
              header: 'Periodical',
              render: (x) => (
                <>
                  <a href={`/library/periodicals/${x.id}`}>
                    <strong>{x.periodical}</strong>
                  </a>
                  <div className="ep-field__help">
                    {[x.kind, x.frequency].filter(Boolean).join(' · ')}
                  </div>
                </>
              ),
            },
            {
              key: 'w',
              header: 'Library · vendor',
              render: (x) => (
                <>
                  {x.library}
                  <div className="ep-field__help">{x.vendor ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'd',
              header: 'Period',
              render: (x) => (
                <>
                  {dmy(x.startsOn)} to {dmy(x.endsOn)}
                  <div>
                    <Badge tone={SUBSCRIPTION_TONE[x.state]}>{SUBSCRIPTION_STATE[x.state]}</Badge>
                  </div>
                </>
              ),
            },
            {
              key: 'i',
              header: 'Received · so far',
              numeric: true,
              render: (x) => `${String(x.received)} of ${String(x.due)}`,
            },
            {
              key: 'l',
              header: 'Late · missing',
              numeric: true,
              render: (x) =>
                x.late || x.missing ? (
                  <Badge tone="danger">
                    {x.late} · {x.missing}
                  </Badge>
                ) : (
                  '—'
                ),
            },
            { key: 'n', header: 'Next issue', render: (x) => (x.nextOn ? dmy(x.nextOn) : '—') },
            { key: 'c', header: 'Copies', numeric: true, render: (x) => x.copies },
            {
              key: 'k',
              header: 'Cost',
              numeric: true,
              render: (x) => (x.cost ? `₹${x.cost}` : '—'),
            },
          ]}
          rows={list.data}
          rowKey={(x) => x.id}
        />
      )}
    </>
  );
}
