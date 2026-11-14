import { Breadcrumbs, Button, Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DownloadMenu } from '@/components/leave/ListBar';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type CertificateReports } from '@/lib/certificates';

type R = CertificateReports;

/**
 * Certificate reports (docs/design/87, phase E): by type, by month, by who issued them, those issued past a check,
 * the requests and their turnaround, the public checks; each as Excel or PDF.
 */
export default async function CertificateReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.view')) notFound();
  const f = new URLSearchParams();
  for (const k of ['from', 'to'] as const)
    if (sp[k] && /^\d{4}-\d{2}-\d{2}$/.test(sp[k]!)) f.set(k, sp[k]!);
  let r: R;
  try {
    r = await apiFetch<R>(`/certificates/reports?${f.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const dl = (kind: string) => (
    <DownloadMenu
      xlsx={`/api/certificates-file?kind=report&report=${kind}&format=xlsx&from=${r.from}&to=${r.to}`}
      pdf={`/api/certificates-file?kind=report&report=${kind}&format=pdf&from=${r.from}&to=${r.to}`}
    />
  );
  const head = (title: string, kind: string) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <h2 className="ep-card__title" style={{ margin: 0 }}>
        {title}
      </h2>
      {dl(kind)}
    </div>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Reports' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Certificate reports"
        description={`${dmy(r.from)} to ${dmy(r.to)}`}
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="from" style={{ margin: 0 }}>
            <span className="ep-field__label">From</span>
            <input id="from" name="from" type="date" className="ep-input" defaultValue={r.from} />
          </label>
          <label className="ep-field" htmlFor="to" style={{ margin: 0 }}>
            <span className="ep-field__label">To</span>
            <input id="to" name="to" type="date" className="ep-input" defaultValue={r.to} />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </Card>
      <div className="ep-dash-kpis">
        <KpiTile label="Issued" value={String(r.figures.issued)} />
        <KpiTile label="Duplicates" value={String(r.figures.duplicates)} />
        <KpiTile label="Cancelled" value={String(r.figures.cancelled)} />
        <KpiTile label="Past a check" value={String(r.figures.overrides)} />
        <KpiTile label="Requests" value={String(r.figures.requests)} />
        <KpiTile label="Public checks" value={String(r.figures.checks)} />
      </div>
      <Card>
        {head('By type', 'types')}
        <DataTable<R['types'][number]>
          caption="Certificates by type"
          density="dense"
          columns={[
            { key: 'n', header: 'Type', render: (x) => x.name },
            { key: 'i', header: 'Issued', render: (x) => String(x.issued) },
            { key: 'd', header: 'Duplicates', render: (x) => String(x.duplicates) },
            { key: 'c', header: 'Cancelled', render: (x) => String(x.cancelled) },
            { key: 'o', header: 'Past a check', render: (x) => String(x.overrides) },
          ]}
          rows={r.types}
          rowKey={(x) => x.name}
          emptyTitle="None in the period"
        />
      </Card>
      <Card>
        {head('By month', 'months')}
        <DataTable<R['months'][number]>
          caption="Certificates by month"
          density="dense"
          columns={[
            { key: 'm', header: 'Month', render: (x) => x.month },
            { key: 'i', header: 'Issued', render: (x) => String(x.issued) },
            { key: 'd', header: 'Duplicates', render: (x) => String(x.duplicates) },
            { key: 'c', header: 'Cancelled', render: (x) => String(x.cancelled) },
          ]}
          rows={r.months}
          rowKey={(x) => x.month}
          emptyTitle="None in the period"
        />
      </Card>
      <Card>
        {head('By who issued them', 'issuers')}
        <DataTable<R['issuers'][number]>
          caption="Certificates by issuer"
          density="dense"
          columns={[
            { key: 'n', header: 'Issued by', render: (x) => x.name },
            { key: 'i', header: 'Issued', render: (x) => String(x.issued) },
            { key: 'o', header: 'Past a check', render: (x) => String(x.overrides) },
          ]}
          rows={r.issuers}
          rowKey={(x) => x.name}
          emptyTitle="None in the period"
        />
      </Card>
      <Card>
        {head('Issued past a failed check', 'overrides')}
        <DataTable<R['overrides'][number]>
          caption="Issued past a failed check"
          density="dense"
          columns={[
            { key: 'n', header: 'Number', render: (x) => x.number },
            { key: 't', header: 'Type', render: (x) => x.type },
            { key: 'd', header: 'Issued on', render: (x) => dmy(x.issuedOn) },
            { key: 'w', header: 'For', render: (x) => x.name ?? '' },
            { key: 'r', header: 'Reason', render: (x) => x.reason },
            { key: 'b', header: 'By', render: (x) => x.by ?? '' },
          ]}
          rows={r.overrides}
          rowKey={(x) => x.number}
          emptyTitle="None in the period"
        />
      </Card>
      <Card>
        {head('Requests', 'requests')}
        <DataTable<R['requests'][number]>
          caption="Certificate requests"
          density="dense"
          columns={[
            { key: 'n', header: 'Type', render: (x) => x.name },
            { key: 'a', header: 'Asked', render: (x) => String(x.asked) },
            { key: 'i', header: 'Issued', render: (x) => String(x.issued) },
            { key: 'r', header: 'Not approved', render: (x) => String(x.rejected) },
            { key: 'o', header: 'Open', render: (x) => String(x.open) },
            {
              key: 'd',
              header: 'Days to issue',
              render: (x) => (x.avgDays === null ? '—' : String(x.avgDays)),
            },
          ]}
          rows={r.requests}
          rowKey={(x) => x.name}
          emptyTitle="None in the period"
        />
        <p className="ep-field__help">
          Public checks: {String(r.checks.total)} ({String(r.checks.valid)} valid,{' '}
          {String(r.checks.cancelled)} cancelled, {String(r.checks.not_found)} not found).
        </p>
      </Card>
    </>
  );
}
