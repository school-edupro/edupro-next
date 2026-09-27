import { Badge, Card, DataTable, PageHeader, toneForStatus } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch } from '@/lib/api';

interface ClassRow {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

interface Page<T> {
  data: T[];
  page: { number: number; size: number; total: number };
}

/** Reference module screen: server component, generated-client shape, tokens-only UI. */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const t = await getTranslations('pages.academics_classes');
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;

  let result: Page<ClassRow> | null = null;
  let problem: ApiError | null = null;
  try {
    result = await apiFetch<Page<ClassRow>>(`/academics/classes?page=${page}&size=50`);
  } catch (error) {
    if (error instanceof ApiError) problem = error;
    else throw error;
  }

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      {problem ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {problem.problem.type === 'permission-denied'
            ? 'You do not have permission to view classes.'
            : problem.problem.type === 'tenant-required'
              ? 'Select a school in the header to continue.'
              : `Could not load classes (${problem.problem.type}).`}
        </div>
      ) : (
        <Card>
          <DataTable<ClassRow>
            caption="Classes"
            columns={[
              { key: 'code', header: 'Code', render: (r) => <strong>{r.code}</strong> },
              { key: 'name', header: 'Name', render: (r) => r.name },
              { key: 'order', header: 'Order', numeric: true, render: (r) => r.displayOrder },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <Badge tone={toneForStatus(r.status)}>{r.status}</Badge>,
              },
              {
                key: 'updated',
                header: 'Updated',
                render: (r) => new Date(r.updatedAt).toLocaleDateString('en-IN'),
              },
            ]}
            rows={result?.data ?? []}
            rowKey={(r) => r.id}
            emptyTitle="No classes yet"
            emptyHint={
              <p>Create the first class through the API or wait for the create form in Sprint 3.</p>
            }
          />
          {result && result.page.total > result.page.size ? (
            <p
              style={{
                marginTop: 'var(--sp-3)',
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-small)',
              }}
            >
              Page {result.page.number} of {Math.ceil(result.page.total / result.page.size)}
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
