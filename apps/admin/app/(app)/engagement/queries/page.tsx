import { redirect } from 'next/navigation';
import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import type { Page, ParentQuery } from '@/lib/types';

const queryTone = (s: ParentQuery['status']) =>
  s === 'closed'
    ? 'neutral'
    : s === 'answered'
      ? 'success'
      : s === 'in_progress'
        ? 'info'
        : 'warning';

export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    status?: string;
    kind?: string;
    categoryCode?: string;
  }>;
}) {
  const sp = await searchParams;
  // queries and complaints live in the helpdesk now; this list stays for leave requests
  if (sp.kind !== 'leave') redirect('/engagement/helpdesk/parent');
  const [t, e] = await Promise.all([
    getTranslations('pages.engagement_queries'),
    getTranslations('engagement'),
  ]);
  const q = new URLSearchParams({ size: '100' });
  for (const k of ['status', 'kind', 'categoryCode'] as const) if (sp[k]) q.set(k, sp[k]!);
  const [page, cats] = await Promise.all([
    apiFetch<Page<ParentQuery>>(`/engagement/queries?${q.toString()}`),
    apiFetch<{ data: Array<{ code: string; name: string }> }>('/engagement/categories').then(
      (r) => r.data,
    ),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title="Leave requests"
        description="Leave requests from families for their children; the class teacher approves or rejects them. Queries and complaints are in the Helpdesk."
      />
      <Notice params={sp} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label={e('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              ...(['open', 'in_progress', 'answered', 'closed'] as const).map((s) => ({
                value: s,
                label: e(`statuses.${s}`),
              })),
            ]}
          />
          <input type="hidden" name="kind" value="leave" />
          <SelectField
            id="categoryCode"
            name="categoryCode"
            label={e('category')}
            defaultValue={sp.categoryCode ?? ''}
            options={[
              { value: '', label: '—' },
              ...cats.map((c) => ({ value: c.code, label: c.name })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {e('status')}
          </Button>
        </form>
        <DataTable<ParentQuery>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'no',
              header: e('number'),
              render: (r) => <a href={`/engagement/queries/${r.id}`}>{r.number}</a>,
            },
            { key: 'kind', header: e('kind'), render: (r) => e(`kinds.${r.kind}`) },
            {
              key: 'subject',
              header: e('subject'),
              render: (r) => (
                <a href={`/engagement/queries/${r.id}`}>
                  <strong>{r.subject}</strong>
                </a>
              ),
            },
            {
              key: 'student',
              header: e('student'),
              render: (r) => `${r.studentName}${r.section ? ` · ${r.section}` : ''}`,
            },
            { key: 'category', header: e('category'), render: (r) => r.categoryName },
            {
              key: 'status',
              header: e('status'),
              render: (r) => <Badge tone={queryTone(r.status)}>{e(`statuses.${r.status}`)}</Badge>,
            },
            {
              key: 'assigned',
              header: e('assignedTo'),
              render: (r) => r.assignedTo ?? r.assignedRole ?? '',
            },
            {
              key: 'opened',
              header: e('opened'),
              render: (r) => new Date(r.openedAt).toLocaleDateString('en-IN'),
            },
          ]}
          rows={page.data}
          rowKey={(r) => r.id}
          emptyTitle={e('noQueries')}
        />
      </Card>
    </>
  );
}
