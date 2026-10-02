import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { ExportWatcher } from '@/components/ExportWatcher';
import { Notice } from '@/components/Notice';
import { builderDeleteForm, builderExportForm } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { pdfColumnCount, type BuilderFields, type SavedReport } from '@/lib/report-builder';

function ReportTable({
  rows,
  pdfLimit,
  showOwner,
}: {
  rows: SavedReport[];
  pdfLimit: BuilderFields['pdfColumnLimit'];
  showOwner: boolean;
}) {
  return (
    <div className="ep-table-wrap">
      <table className="ep-table">
        <thead>
          <tr>
            <th scope="col">Report</th>
            <th scope="col">Columns</th>
            <th scope="col">Filters</th>
            {showOwner ? <th scope="col">Owner</th> : <th scope="col">Shared</th>}
            <th scope="col">Last run</th>
            <th scope="col">Download</th>
            <th scope="col">
              <span className="ep-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pdfOk = pdfColumnCount(r.spec) <= pdfLimit[r.spec.options.paper];
            return (
              <tr key={r.id}>
                <td>
                  <a href={`/reports/builder/${r.id}`}>
                    <strong>{r.name}</strong>
                  </a>
                  {r.description ? <div className="ep-field__help">{r.description}</div> : null}
                </td>
                <td>{r.spec.columns.length}</td>
                <td>{r.spec.filters.length || '—'}</td>
                <td>
                  {showOwner ? (
                    <>
                      {r.ownerName ?? '—'}{' '}
                      {r.canEdit ? (
                        <Badge tone="info">can edit</Badge>
                      ) : (
                        <Badge tone="neutral">view only</Badge>
                      )}
                    </>
                  ) : r.shares.length ? (
                    <Badge tone="info">{r.shares.length}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{r.lastRunAt ? new Date(r.lastRunAt).toLocaleString('en-IN') : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                    <form action={builderExportForm}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="format" value="xlsx" />
                      <button
                        type="submit"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        aria-label={`Excel of ${r.name}`}
                      >
                        Excel
                      </button>
                    </form>
                    <form action={builderExportForm}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="format" value="pdf" />
                      <button
                        type="submit"
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        disabled={!pdfOk}
                        title={
                          pdfOk
                            ? undefined
                            : 'Too many columns for a PDF page; open the report to use A3 or fewer columns'
                        }
                        aria-label={`PDF of ${r.name}`}
                      >
                        PDF
                      </button>
                    </form>
                  </div>
                </td>
                <td>
                  {r.canShare ? (
                    <ConfirmAction
                      action={builderDeleteForm}
                      fields={{ id: r.id }}
                      label="Delete"
                      variant="ghost"
                      title={`Delete "${r.name}"?`}
                      confirmLabel="Delete"
                      confirmVariant="danger"
                    >
                      <p>
                        The report disappears for you and everyone it is shared with. Files already
                        downloaded stay.
                      </p>
                    </ConfirmAction>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportBuilderListPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    export?: string;
    format?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('reports.builder.use')) notFound();
  const [lists, fields] = await Promise.all([
    apiFetch<{ mine: SavedReport[]; shared: SavedReport[]; others: SavedReport[] }>(
      '/reports/builder',
    ),
    apiFetch<BuilderFields>('/reports/builder/fields'),
  ]);
  return (
    <>
      <PageHeader
        kicker="Reports"
        title="Report builder"
        description="Make your own student reports from every profile field: choose columns, name the headers, filter, sort, save, share with colleagues, and download Excel or PDF on the school letterhead."
        actions={
          <a className="ep-btn ep-btn--primary" href="/reports/builder/new">
            New report
          </a>
        }
      />
      <Notice params={sp} />
      {sp.export && /^\d{1,18}$/.test(sp.export) ? (
        <ExportWatcher
          id={sp.export}
          format={sp.format === 'pdf' ? 'pdf' : 'xlsx'}
          labels={{
            queued: 'Report requested',
            ready: 'Download',
            pending: 'Preparing the file… it downloads automatically',
            failed: 'The file could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}
      <Card title={`My reports (${String(lists.mine.length)})`}>
        {lists.mine.length ? (
          <ReportTable rows={lists.mine} pdfLimit={fields.pdfColumnLimit} showOwner={false} />
        ) : (
          <p className="ep-field__help">
            No reports yet. <a href="/reports/builder/new">Build the first one</a>.
          </p>
        )}
      </Card>
      <Card
        title={`Shared with me (${String(lists.shared.length)})`}
        style={{ marginTop: 'var(--sp-5)' }}
      >
        {lists.shared.length ? (
          <ReportTable rows={lists.shared} pdfLimit={fields.pdfColumnLimit} showOwner />
        ) : (
          <p className="ep-field__help">
            Reports colleagues share with you, or with your role, appear here.
          </p>
        )}
      </Card>
      {fields.canManage && lists.others.length ? (
        <Card
          title={`Other reports of the school (${String(lists.others.length)})`}
          style={{ marginTop: 'var(--sp-5)' }}
        >
          <ReportTable rows={lists.others} pdfLimit={fields.pdfColumnLimit} showOwner />
        </Card>
      ) : null}
    </>
  );
}
