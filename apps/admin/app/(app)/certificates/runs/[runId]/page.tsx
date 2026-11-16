import { Badge, Breadcrumbs, Card, DataTable, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { RefreshWhilePending } from '@/components/RefreshWhilePending';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type BulkRun } from '@/lib/certificates';

type B = BulkRun['batches'][number];

/**
 * A bulk run (16 Nov 2026): what was issued, a batch and a PDF for each section or department, each to View or Download,
 * and every PDF in one ZIP once they are made. The page follows the PDFs being made.
 */
export default async function BulkRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(runId)) notFound();
  let run: BulkRun;
  try {
    run = await apiFetch<BulkRun>(`/certificates/runs/${runId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const f = run.figures;
  const allReady = f.withPdf > 0 && f.ready === f.withPdf;
  const pending = run.batches.some(
    (b) => b.exportId && (b.exportStatus === 'queued' || b.exportStatus === 'running'),
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Bulk issue', href: '/certificates/bulk' },
          { label: 'Issued' },
        ]}
      />
      <PageHeader
        kicker={run.typeName}
        title={`${String(f.issued)} issued in ${String(f.batches)} batch${f.batches === 1 ? '' : 'es'}`}
        description={`${dmy(run.createdAt.slice(0, 10))}${run.by ? ` · ${run.by}` : ''} · a batch and a PDF for each section or department`}
        actions={
          allReady ? (
            <a
              className="ep-btn ep-btn--primary ep-btn--sm"
              href={`/certificates/runs/${runId}/zip`}
            >
              Download all (ZIP)
            </a>
          ) : null
        }
      />
      {sp.ok === 'issued' ? (
        <div className="ep-alert ep-alert--success" role="status">
          Issued. {pending ? 'The PDFs are being made; this page shows each as it is ready.' : ''}
        </div>
      ) : (
        <Notice params={sp} />
      )}
      <RefreshWhilePending ready={!pending} />
      <div className="ep-dash-kpis">
        <KpiTile label="Batches" value={String(f.batches)} />
        <KpiTile label="Issued" value={String(f.issued)} />
        <KpiTile label="Left out" value={String(f.skipped)} />
        <KpiTile label="PDFs ready" value={`${String(f.ready)} of ${String(f.withPdf)}`} />
      </div>
      <Card>
        <DataTable<B>
          caption="Batches of this issue"
          density="dense"
          columns={[
            {
              key: 'title',
              header: 'Batch',
              render: (b) => <a href={`/certificates/batches/${b.id}`}>{b.title}</a>,
            },
            { key: 'issued', header: 'Issued', render: (b) => String(b.issued) },
            {
              key: 'skipped',
              header: 'Left out',
              render: (b) => (b.skipped ? <Badge tone="warning">{String(b.skipped)}</Badge> : '0'),
            },
            {
              key: 'pdf',
              header: 'PDF',
              render: (b) =>
                !b.exportId ? (
                  '—'
                ) : b.exportStatus === 'ready' ? (
                  <FileLinks href={`/reports/exports/${b.exportId}/download`} label={b.title} />
                ) : b.exportStatus === 'failed' ? (
                  <a href={`/reports/exports/${b.exportId}`}>Could not be made — try again</a>
                ) : (
                  <span className="ep-field__help" style={{ margin: 0 }}>
                    Being made…
                  </span>
                ),
            },
          ]}
          rows={run.batches}
          rowKey={(b) => b.id}
          emptyTitle="No batch"
        />
        {!allReady && f.withPdf ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            Download all (ZIP) appears when every PDF is made.
          </p>
        ) : null}
      </Card>
    </>
  );
}
