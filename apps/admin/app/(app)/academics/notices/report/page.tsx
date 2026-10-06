import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { apiFetch } from '@/lib/api';

interface Row {
  id: string;
  kind: string;
  title: string;
  targets: string;
  publishFrom: string;
  publishedBy: string | null;
  students: number;
  employees: number;
  ackRequired: boolean;
  acknowledged: number;
  emailed: number | null;
  attachments: number;
}
const KIND: Record<string, string> = {
  notice: 'Notice',
  circular: 'Circular',
  office_order: 'Office order',
};

/**
 * Notices and office orders report: what was published, for whom, how many students and employees it
 * reaches, how many acknowledged and how many e-mails went. Downloads as Excel or PDF with the school's
 * header.
 */
export default async function NoticesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const filters: Record<string, string> = {};
  if (sp.kind && KIND[sp.kind]) filters.kind = sp.kind;
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) filters[k] = sp[k]!;
  const qs = new URLSearchParams(filters).toString();
  const r = await apiFetch<{ data: Row[] }>(`/academics/notices/report?${qs}`);
  const sum = (k: 'students' | 'employees' | 'acknowledged') =>
    r.data.reduce((n, x) => n + x[k], 0);
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Notices and office orders report"
        description="What was published, whom it reaches, the acknowledgements and the e-mails."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/notices">
              Notices
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/academics/notices-report?${qs}&format=xlsx`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/academics/notices-report?${qs}&format=pdf`}
            >
              PDF
            </a>
          </>
        }
      />
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <SelectField
            id="nr-kind"
            name="kind"
            label="Kind"
            defaultValue={filters.kind ?? ''}
            options={[
              { value: '', label: 'All kinds' },
              ...Object.entries(KIND).map(([value, label]) => ({ value, label })),
            ]}
          />
          <InputField
            id="nr-from"
            name="from"
            type="date"
            label="From"
            defaultValue={filters.from ?? ''}
          />
          <InputField id="nr-to" name="to" type="date" label="To" defaultValue={filters.to ?? ''} />
          <Button type="submit">Show</Button>
          {Object.keys(filters).length ? (
            <a className="ep-btn ep-btn--secondary" href="/academics/notices/report">
              Clear
            </a>
          ) : null}
        </form>
      </div>
      <div className="ep-cdash__kpis">
        {(
          [
            ['Published', String(r.data.length)],
            ['Office orders', String(r.data.filter((x) => x.kind === 'office_order').length)],
            ['Acknowledgements', String(sum('acknowledged'))],
            ['E-mails sent', String(r.data.reduce((n, x) => n + (x.emailed ?? 0), 0))],
          ] as Array<[string, string]>
        ).map(([title, value]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <span className="ep-cdash__num">{value}</span>
            </div>
          </Card>
        ))}
      </div>
      <Card style={{ marginTop: 'var(--sp-4)' }}>
        {r.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing was published for these filters.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Notices report">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Notices and office orders</caption>
              <thead>
                <tr>
                  <th scope="col">S.no</th>
                  <th scope="col">Date</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Title</th>
                  <th scope="col">For</th>
                  <th scope="col">Published by</th>
                  <th scope="col" className="ep-num">
                    Students
                  </th>
                  <th scope="col" className="ep-num">
                    Employees
                  </th>
                  <th scope="col" className="ep-num">
                    Acknowledged
                  </th>
                  <th scope="col" className="ep-num">
                    E-mailed
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.data.map((n, i) => (
                  <tr key={n.id}>
                    <td>{i + 1}</td>
                    <td>{n.publishFrom}</td>
                    <td>
                      <Badge tone={n.kind === 'office_order' ? 'info' : 'neutral'}>
                        {KIND[n.kind] ?? n.kind}
                      </Badge>
                    </td>
                    <th scope="row">{n.title}</th>
                    <td>{n.targets}</td>
                    <td>{n.publishedBy ?? ''}</td>
                    <td className="ep-num">{n.students}</td>
                    <td className="ep-num">{n.employees}</td>
                    <td className="ep-num">
                      {n.ackRequired ? (
                        <a
                          href={`/academics/acknowledgements?type=notice&id=${n.id}`}
                          style={{ textDecoration: 'underline' }}
                          aria-label={`Who acknowledged ${n.title}`}
                        >
                          {n.acknowledged}
                        </a>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="ep-num">{n.emailed ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
