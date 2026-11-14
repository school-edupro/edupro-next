import { Badge, Breadcrumbs, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExportWatcher } from '@/components/ExportWatcher';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type CertificateBatch } from '@/lib/certificates';

type I = CertificateBatch['issued'][number];

/** A batch of certificates (docs/design/87, phase E): who got one, who was left out and why, the PDF of the batch. */
export default async function BatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let b: CertificateBatch;
  try {
    b = await apiFetch<CertificateBatch>(`/certificates/batches/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const ready = b.exportId
    ? await apiFetch<{ export: { status: string } }>(`/reports/exports/${b.exportId}`)
        .then((r) => r.export.status === 'ready')
        .catch(() => false)
    : false;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Bulk issue', href: '/certificates/bulk' },
          { label: `Batch ${b.id}` },
        ]}
      />
      <PageHeader
        kicker={b.typeName}
        title={b.title}
        description={`${dmy(b.createdAt.slice(0, 10))}${b.by ? ` · ${b.by}` : ''}`}
      />
      {sp.ok === 'issued' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Issued. The PDF of the batch is being made.
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <div className="ep-dash-kpis">
        <KpiTile label="Issued" value={String(b.issued.length)} />
        <KpiTile label="Left out" value={String(b.skipped.length)} />
        <KpiTile label="Past a check" value={String(b.issued.filter((x) => x.override).length)} />
        <KpiTile
          label="Cancelled since"
          value={String(b.issued.filter((x) => x.status === 'cancelled').length)}
        />
        <KpiTile label="First number" value={b.issued[0]?.number ?? '—'} />
        <KpiTile label="Last number" value={b.issued[b.issued.length - 1]?.number ?? '—'} />
      </div>
      <section className="ep-card" aria-labelledby="bt-pdf">
        <h2 id="bt-pdf" className="ep-card__title">
          The batch PDF
        </h2>
        {b.exportId && ready ? (
          <FileLinks href={`/reports/exports/${b.exportId}/download`} label={`Batch ${b.id}`} />
        ) : b.exportId ? (
          <ExportWatcher
            id={b.exportId}
            format="pdf"
            labels={{
              queued: 'PDF requested',
              ready: 'Open',
              pending: 'Making the PDF…',
              failed: 'The PDF could not be made',
              stuck: 'Still waiting: the workers service makes the PDFs; check that it is running.',
            }}
          />
        ) : (
          <p className="ep-field__help">Nothing was issued, so there is no PDF.</p>
        )}
        {b.overrideReason ? (
          <p className="ep-field__help">Issued past a failed check: {b.overrideReason}</p>
        ) : null}
      </section>
      <FoldCard
        id="bt-issued"
        title="Issued"
        hint={`${String(b.issued.length)} in roll order`}
        open
      >
        <DataTable<I>
          caption="Issued in this batch"
          density="dense"
          columns={[
            {
              key: 'n',
              header: 'Number',
              render: (x) => <a href={`/certificates/${x.id}`}>{x.number}</a>,
            },
            { key: 's', header: 'Student', render: (x) => `${x.name} · ${x.admissionNo}` },
            {
              key: 'st',
              header: 'Status',
              render: (x) => (
                <>
                  <Badge tone={x.status === 'issued' ? 'success' : 'danger'}>
                    {x.status === 'issued' ? 'Issued' : 'Cancelled'}
                  </Badge>
                  {x.override ? <Badge tone="warning">Past a check</Badge> : null}
                </>
              ),
            },
          ]}
          rows={b.issued}
          rowKey={(x) => x.id}
          emptyTitle="None"
        />
      </FoldCard>
      <FoldCard
        id="bt-skipped"
        title="Left out"
        hint={b.skipped.length ? `${String(b.skipped.length)} with the reason` : 'Nobody'}
        open={b.skipped.length > 0}
      >
        {b.skipped.length ? (
          <ul className="ep-cert-checks">
            {b.skipped.map((x) => (
              <li key={x.studentId}>
                <strong>{x.name}</strong>: {x.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ep-field__help">Everybody got one.</p>
        )}
      </FoldCard>
    </>
  );
}
