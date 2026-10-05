import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { dayLabel, type FleetPaper } from '@/lib/transport-desk';

interface Papers {
  data: FleetPaper[];
  counts: { expired: number; soon: number; valid: number; missing: number };
  days: number;
}
const STATES = ['soon', 'expired', 'missing', 'valid', 'all'] as const;
type State = (typeof STATES)[number];
const KINDS: Array<[string, string]> = [
  ['insurance', 'Insurance'],
  ['fitness', 'Fitness certificate'],
  ['permit', 'Permit'],
  ['puc', 'PUC'],
  ['licence', 'Driving licence'],
];

/**
 * The papers of the fleet: every vehicle's insurance, fitness certificate, permit and PUC, and every
 * driver's licence, with the day each runs out and the days left. What runs out in 30 days first.
 */
export default async function FleetPapersPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const state: State = STATES.includes(sp.state as State) ? (sp.state as State) : 'soon';
  const filters = Object.fromEntries(
    Object.entries({
      state,
      kind: KINDS.some(([k]) => k === sp.kind) ? sp.kind : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const qs = new URLSearchParams(filters).toString();
  const [me, p] = await Promise.all([getMe(), apiFetch<Papers>(`/transport/desk/papers?${qs}`)]);
  const tabs: Array<[State, string, number | null]> = [
    ['soon', `Running out in ${String(p.days)} days`, p.counts.soon],
    ['expired', 'Expired', p.counts.expired],
    ['missing', 'Date not recorded', p.counts.missing],
    ['valid', 'Valid', p.counts.valid],
    ['all', 'Everything', null],
  ];
  const stateOf = (x: FleetPaper): [string, 'danger' | 'warning' | 'success' | 'neutral'] =>
    x.daysLeft === null
      ? ['Not recorded', 'neutral']
      : x.daysLeft < 0
        ? ['Expired', 'danger']
        : x.daysLeft <= p.days
          ? ['Running out', 'warning']
          : ['Valid', 'success'];
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Fleet papers"
        description="Insurance, fitness certificate, permit and PUC of every vehicle, and the driving licence of every driver. Renew before the day; the dates are kept under Transport setup."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/api/transport/papers?${qs}`}>
            Excel
          </a>
        }
      />
      <TransportNav current="/transport/papers" permissions={me.permissions} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/transport/papers?state=${value}`}
            aria-current={state === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="state" value={state} />
          <SelectField
            id="fp-kind"
            name="kind"
            label="Paper"
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: 'All papers' },
              ...KINDS.map(([value, label]) => ({ value, label })),
            ]}
          />
          <InputField
            id="fp-q"
            name="q"
            type="search"
            label="Vehicle no., vehicle name or driver"
            defaultValue={filters.q ?? ''}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
          {Object.keys(filters).length > 1 ? (
            <a className="ep-btn ep-btn--secondary" href={`/transport/papers?state=${state}`}>
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <Card>
        {p.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {state === 'soon'
              ? `Nothing runs out in the next ${String(p.days)} days.`
              : 'Nothing here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Fleet papers">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Fleet papers, the earliest date first</caption>
              <thead>
                <tr>
                  <th scope="col">Vehicle or driver</th>
                  <th scope="col">Paper</th>
                  <th scope="col">Valid till</th>
                  <th scope="col" className="ep-num">
                    Days left
                  </th>
                  <th scope="col">State</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.data.map((x) => {
                  const [label, tone] = stateOf(x);
                  return (
                    <tr key={`${x.owner}-${x.ownerId}-${x.kind}`}>
                      <th scope="row">
                        {x.name}
                        <div className="ep-field__help">
                          {[x.owner === 'vehicle' ? 'Vehicle' : 'Driver', x.detail]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </th>
                      <td>{x.paper}</td>
                      <td>{x.validTill ? dayLabel(x.validTill) : '—'}</td>
                      <td className="ep-num">
                        {x.daysLeft === null
                          ? '—'
                          : x.daysLeft < 0
                            ? `${String(-x.daysLeft)} ago`
                            : x.daysLeft}
                      </td>
                      <td>
                        <Badge tone={tone}>{label}</Badge>
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/masters/transport?tab=${x.owner === 'vehicle' ? 'transport_vehicles' : 'transport_drivers'}&edit=${x.ownerId}`}
                          aria-label={`Update ${x.paper} of ${x.name}`}
                        >
                          Update
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
