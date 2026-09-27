import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { validateImport } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { ImportRow, Page } from '@/lib/types';

type Columns = Record<
  'students' | 'employees',
  { required: readonly string[]; optional: readonly string[] }
>;

const tone = (s: ImportRow['status']) =>
  s === 'committed' ? 'success' : s === 'failed' ? 'danger' : 'info';

/** S6-05: CSV import with a dry run; the report page commits a clean file. */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, i] = await Promise.all([
    getTranslations('pages.people_import'),
    getTranslations('imports'),
  ]);
  const [history, columns] = await Promise.all([
    apiFetch<Page<ImportRow>>('/people/imports?size=50'),
    apiFetch<Columns>('/people/imports/columns'),
  ]);
  const template = (kind: keyof Columns) =>
    `data:text/csv;charset=utf-8,${encodeURIComponent(`${[...columns[kind].required, ...columns[kind].optional].join(',')}\n`)}`;

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card title={i('validate')}>
        <form action={validateImport}>
          <FormRow columns={3}>
            <SelectField
              id="kind"
              name="kind"
              label={i('kind')}
              options={(['students', 'employees'] as const).map((k) => ({
                value: k,
                label: i(`kinds.${k}`),
              }))}
            />
            <InputField
              id="file"
              name="file"
              label={i('file')}
              type="file"
              accept=".csv,text/csv"
              required
            />
          </FormRow>
          <FormActions>
            <Button type="submit">{i('validate')}</Button>
          </FormActions>
        </form>
      </Card>

      <Card title={i('templates')} style={{ marginTop: 'var(--sp-5)' }}>
        <p className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
          {i('templateHelp')}
        </p>
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          {(['students', 'employees'] as const).map((k) => (
            <div key={k}>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={template(k)}
                download={`${k}-template.csv`}
              >
                {i(`kinds.${k}`)} CSV
              </a>
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
                <strong>{i('columns')}:</strong>{' '}
                {[...columns[k].required.map((x) => `${x}*`), ...columns[k].optional].join(', ')}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card title={i('history')} style={{ marginTop: 'var(--sp-5)' }}>
        <DataTable<ImportRow>
          caption={i('history')}
          density="dense"
          columns={[
            {
              key: 'file',
              header: i('file'),
              render: (r) => <a href={`/people/import/${r.id}`}>{r.fileName ?? r.id}</a>,
            },
            { key: 'kind', header: i('kind'), render: (r) => i(`kinds.${r.kind}`) },
            {
              key: 'status',
              header: i('status'),
              render: (r) => <Badge tone={tone(r.status)}>{i(`statuses.${r.status}`)}</Badge>,
            },
            { key: 'total', header: i('total'), numeric: true, render: (r) => r.totalRows },
            { key: 'ok', header: i('ok'), numeric: true, render: (r) => r.okRows },
            {
              key: 'rejected',
              header: i('rejected'),
              numeric: true,
              render: (r) => r.rejectedRows,
            },
            {
              key: 'when',
              header: i('when'),
              render: (r) => new Date(r.createdAt).toLocaleString('en-IN'),
            },
          ]}
          rows={history.data}
          rowKey={(r) => r.id}
          emptyTitle={i('noHistory')}
        />
      </Card>
    </>
  );
}
