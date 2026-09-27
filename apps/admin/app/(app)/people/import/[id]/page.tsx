import { Alert, Badge, Breadcrumbs, Button, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { commitImport } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { ImportIssue, ImportRow } from '@/lib/types';

export default async function ImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, p, i, imp] = await Promise.all([
    getTranslations('pages.people_import_detail'),
    getTranslations('pages.people_import'),
    getTranslations('imports'),
    apiFetch<ImportRow>(`/people/imports/${id}`),
  ]);
  const previewColumns = Object.keys(imp.preview[0] ?? {});
  const issues = imp.report.map((x, idx) => ({ ...x, key: String(idx) }));
  const preview: Array<Record<string, string> & { __key: string }> = imp.preview.map((r, idx) => ({
    ...r,
    __key: String(idx),
  }));
  const canCommit = imp.status === 'validated' && imp.rejectedRows === 0;
  const stat = (label: string, value: number, tone: 'neutral' | 'success' | 'danger') => (
    <Card elevated>
      <div className="ep-kicker">{label}</div>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
        <Badge tone={tone}>{value}</Badge>
      </div>
    </Card>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/students' },
          { label: p('title'), href: '/people/import' },
          { label: imp.fileName ?? imp.id },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')}: ${imp.fileName ?? imp.id}`}
        description={`${i(`kinds.${imp.kind}`)} · ${i(`statuses.${imp.status}`)} · ${new Date(imp.createdAt).toLocaleString('en-IN')}`}
        actions={
          canCommit ? (
            <form action={commitImport}>
              <input type="hidden" name="id" value={imp.id} />
              <Button type="submit">{i('commit', { count: imp.okRows })}</Button>
            </form>
          ) : (
            <a className="ep-btn ep-btn--secondary" href="/people/import">
              {i('back')}
            </a>
          )
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {stat(i('total'), imp.totalRows, 'neutral')}
        {stat(i('ok'), imp.okRows, 'success')}
        {stat(i('rejected'), imp.rejectedRows, imp.rejectedRows > 0 ? 'danger' : 'neutral')}
      </div>
      {imp.status === 'committed' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="success">
            {i('committed', {
              date: new Date(imp.committedAt ?? imp.createdAt).toLocaleString('en-IN'),
            })}
          </Alert>
        </div>
      ) : imp.status === 'failed' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="danger">{i('failed')}</Alert>
        </div>
      ) : imp.rejectedRows > 0 ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="warning">{i('cannotCommit')}</Alert>
        </div>
      ) : null}

      <Card title={i('report')}>
        <DataTable<ImportIssue & { key: string }>
          caption={i('report')}
          density="dense"
          columns={[
            {
              key: 'row',
              header: i('row'),
              numeric: true,
              render: (x) => (x.row === 0 ? i('headerRow') : x.row),
            },
            { key: 'field', header: i('field'), render: (x) => <code>{x.field}</code> },
            { key: 'message', header: i('message'), render: (x) => x.message },
          ]}
          rows={issues}
          rowKey={(x) => x.key}
          emptyTitle={i('noIssues')}
        />
      </Card>

      {previewColumns.length > 0 ? (
        <Card title={i('preview')} style={{ marginTop: 'var(--sp-5)' }}>
          <DataTable<Record<string, string> & { __key: string }>
            caption={i('preview')}
            density="dense"
            columns={previewColumns.map((col) => ({
              key: col,
              header: col,
              render: (r: Record<string, string>) => r[col] ?? '',
            }))}
            rows={preview}
            rowKey={(r) => r.__key}
            emptyTitle={i('noHistory')}
          />
        </Card>
      ) : null}
    </>
  );
}
