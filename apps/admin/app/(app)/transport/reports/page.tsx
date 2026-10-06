import { Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';

type Cell = string | number | null;
type Filter = 'route' | 'months' | 'dates' | 'measure' | 'service' | 'q';
interface Catalogue {
  reports: Array<{
    id: string;
    title: string;
    group: 'students' | 'fees';
    about: string;
    filters: Filter[];
  }>;
  routes: Array<{ id: string; code: string; name: string }>;
  months: string[];
  /** The routes whose fee this person may see; null = every route. */
  feeRoutes: string[] | null;
}
interface Report {
  id: string;
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string; right?: boolean }>;
  rows: Array<Record<string, Cell>>;
  totals: Record<string, number> | null;
  truncated: boolean;
}
const KEYS = ['routeId', 'service', 'fromMonth', 'toMonth', 'from', 'to', 'measure', 'q'] as const;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const show = (v: Cell | undefined) =>
  v === null || v === undefined || v === ''
    ? '–'
    : typeof v === 'number'
      ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
      : v;

/**
 * The transport reports: who rides which route (the mapping sheet, counts by route, stoppage and class)
 * and the transport fee by route, by student and by receipt date. Each one shows here with its filters
 * and comes as Excel or PDF with the school's name on top.
 */
export default async function TransportReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const [me, cat] = await Promise.all([getMe(), apiFetch<Catalogue>('/transport/reports')]);
  const def = cat.reports.find((r) => r.id === sp.r) ?? cat.reports[0];
  if (!def)
    return (
      <>
        <PageHeader kicker="Transport" title="Reports" />
        <TransportNav current="/transport/reports" permissions={me.permissions} />
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            Your role has no transport report. Ask the school admin.
          </p>
        </Card>
      </>
    );
  const filters: Record<string, string> = {};
  for (const k of KEYS) {
    const v = sp[k]?.trim();
    if (v) filters[k] = v.slice(0, 80);
  }
  const qs = new URLSearchParams(filters).toString();
  const rep = await apiFetch<Report>(`/transport/reports/${def.id}?${qs}`);
  const file = (format: string) =>
    `/api/transport/reports?${new URLSearchParams({ r: def.id, format, ...filters }).toString()}`;
  const routes =
    def.group === 'fees' && cat.feeRoutes
      ? cat.routes.filter((r) => cat.feeRoutes!.includes(r.id))
      : cat.routes;
  const has = (f: Filter) => def.filters.includes(f);
  const monthOptions = [
    { value: '', label: 'Session start' },
    ...cat.months.map((m) => ({ value: m, label: monthLabel(m) })),
  ];
  const groups: Array<['students' | 'fees', string]> = [
    ['students', 'Students on the bus'],
    ['fees', 'Transport fee'],
  ];
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Reports"
        description="Route-wise students and the transport fee by route. Pick a report, set the filters, then download it as Excel or PDF."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
              Excel
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
              PDF
            </a>
          </>
        }
      />
      <TransportNav current="/transport/reports" permissions={me.permissions} />
      {groups
        .filter(([g]) => cat.reports.some((r) => r.group === g))
        .map(([g, label]) => (
          <nav
            key={g}
            className="ep-tabs-links"
            aria-label={label}
            style={{ marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}
          >
            <span className="ep-kicker" style={{ alignSelf: 'center' }}>
              {label}
            </span>
            {cat.reports
              .filter((r) => r.group === g)
              .map((r) => (
                <a
                  key={r.id}
                  href={`/transport/reports?r=${r.id}`}
                  aria-current={r.id === def.id ? 'page' : undefined}
                >
                  {r.title}
                </a>
              ))}
          </nav>
        ))}
      <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>
        {def.about}
        {def.group === 'fees' && cat.feeRoutes ? ' You see the routes you are in-charge of.' : ''}
      </p>
      {def.filters.length ? (
        <div className="ep-filter-band">
          <form method="get" className="ep-dlog__filters">
            <input type="hidden" name="r" value={def.id} />
            {has('route') ? (
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
            ) : null}
            {has('service') ? (
              <SelectField
                id="tr-service"
                name="service"
                label="Travel mode"
                defaultValue={filters.service ?? ''}
                options={[
                  { value: '', label: 'All' },
                  { value: 'both', label: 'Pick-up and drop' },
                  { value: 'pick', label: 'Pick-up only' },
                  { value: 'drop', label: 'Drop only' },
                ]}
              />
            ) : null}
            {has('months') ? (
              <>
                <SelectField
                  id="tr-from-month"
                  name="fromMonth"
                  label="From month"
                  defaultValue={filters.fromMonth ?? ''}
                  options={monthOptions}
                />
                <SelectField
                  id="tr-to-month"
                  name="toMonth"
                  label="To month"
                  defaultValue={filters.toMonth ?? ''}
                  options={[{ value: '', label: 'Session end' }, ...monthOptions.slice(1)]}
                />
              </>
            ) : null}
            {has('measure') ? (
              <SelectField
                id="tr-measure"
                name="measure"
                label="Months show"
                defaultValue={filters.measure ?? 'projected'}
                options={[
                  { value: 'projected', label: 'Projected' },
                  { value: 'collected', label: 'Collected' },
                  { value: 'balance', label: 'Balance' },
                ]}
              />
            ) : null}
            {has('dates') ? (
              <>
                <InputField
                  id="tr-from"
                  name="from"
                  type="date"
                  label="Received from"
                  defaultValue={filters.from ?? ''}
                />
                <InputField
                  id="tr-to"
                  name="to"
                  type="date"
                  label="Received to"
                  defaultValue={filters.to ?? ''}
                />
              </>
            ) : null}
            {has('q') ? (
              <InputField
                id="tr-q"
                name="q"
                type="search"
                label={
                  def.id === 'fee-collection'
                    ? 'Student, admission no. or receipt no.'
                    : 'Student or admission no.'
                }
                defaultValue={filters.q ?? ''}
                maxLength={80}
              />
            ) : null}
            <Button type="submit">Show</Button>
            {Object.keys(filters).length ? (
              <a className="ep-btn ep-btn--secondary" href={`/transport/reports?r=${def.id}`}>
                Clear
              </a>
            ) : null}
          </form>
        </div>
      ) : null}
      <Card title={rep.title}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {rep.subtitle} · {rep.rows.length} {rep.rows.length === 1 ? 'row' : 'rows'}
          {rep.truncated ? ' (the first 10,000; narrow the filters for the rest)' : ''}
        </p>
        {rep.rows.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing to show for these filters.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={rep.title}>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{rep.title}</caption>
              <thead>
                <tr>
                  {rep.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      style={c.right ? { textAlign: 'right' } : undefined}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rep.rows.map((r, i) => (
                  <tr key={i}>
                    {rep.columns.map((c) => (
                      <td key={c.key} style={c.right ? { textAlign: 'right' } : undefined}>
                        {c.key === 'student' && def.group === 'fees' && r.student_id ? (
                          <a
                            href={`/transport/reports/fee/${String(r.student_id)}`}
                            style={{ textDecoration: 'underline' }}
                          >
                            {show(r[c.key])}
                          </a>
                        ) : (
                          show(r[c.key])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {rep.totals ? (
                <tfoot>
                  <tr>
                    {rep.columns.map((c, i) => (
                      <th
                        key={c.key}
                        scope={i === 0 ? 'row' : undefined}
                        style={{ textAlign: c.right ? 'right' : 'left' }}
                      >
                        {c.key in rep.totals! ? show(rep.totals![c.key]) : i === 0 ? 'Total' : ''}
                      </th>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
