import { Badge, Button, Card, DataTable, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createExport } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Dataset, ExportRow, Page } from '@/lib/types';

const TONE: Record<ExportRow['status'], 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'info',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; mine?: string }>;
}) {
  const t = await getTranslations('pages.reports_exports');
  const sp = await searchParams;
  const mine = sp.mine === 'false' ? 'false' : 'true';
  const [exports, datasets] = await Promise.all([
    apiFetch<Page<ExportRow>>(`/reports/exports?mine=${mine}&size=100`),
    apiFetch<{ data: Dataset[] }>('/reports/datasets'),
  ]);

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <div className="ep-filter-band">
        <form method="get" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
          <SelectField
            id="mine"
            name="mine"
            label="Show"
            defaultValue={mine}
            options={[
              { value: 'true', label: 'My exports' },
              { value: 'false', label: 'Everyone in the school' },
            ]}
          />
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>
      <Card>
        <DataTable<ExportRow>
          caption="Exports"
          columns={[
            { key: 'title', header: 'Export', render: (e) => `${e.title} (${e.format})` },
            { key: 'who', header: 'Requested by', render: (e) => e.requestedByName ?? '' },
            {
              key: 'when',
              header: 'Requested',
              render: (e) => new Date(e.requestedAt).toLocaleString('en-IN'),
            },
            { key: 'rows', header: 'Rows', numeric: true, render: (e) => e.rowCount ?? '' },
            {
              key: 'status',
              header: 'Status',
              render: (e) => <Badge tone={TONE[e.status]}>{e.status}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              render: (e) =>
                e.status === 'ready' ? (
                  <a
                    className="ep-btn ep-btn--primary ep-btn--sm"
                    href={`/reports/exports/${e.id}/download`}
                  >
                    Download
                  </a>
                ) : e.status === 'failed' ? (
                  <span className="ep-field__error">{e.error}</span>
                ) : null,
            },
          ]}
          rows={exports.data}
          rowKey={(e) => e.id}
          emptyTitle="No exports yet"
        />
      </Card>
      <Card title="New export" style={{ marginTop: 'var(--sp-5)' }}>
        <form
          action={createExport}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--sp-4)',
            alignItems: 'end',
          }}
        >
          <SelectField
            id="dataset"
            name="dataset"
            label="Dataset"
            required
            options={datasets.data.map((d) => ({
              value: d.id,
              label: `${d.title} (up to ${d.maxRows.toLocaleString('en-IN')} rows)`,
            }))}
          />
          <SelectField
            id="format"
            name="format"
            label="Format"
            options={[
              { value: 'xlsx', label: 'Excel' },
              { value: 'csv', label: 'CSV' },
              { value: 'pdf', label: 'PDF' },
            ]}
          />
          <InputField id="title" name="title" label="Title" placeholder="Optional" />
          <div>
            <Button type="submit">Create export</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
