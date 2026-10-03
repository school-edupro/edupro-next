import { Card, DataTable, KpiTile, PageHeader, Stars } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { FeedbackEntry } from '@/lib/types';

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const sp = await searchParams;
  const [t, e] = await Promise.all([
    getTranslations('pages.engagement_feedback'),
    getTranslations('engagement'),
  ]);
  const res = await apiFetch<{
    data: FeedbackEntry[];
    summary: Array<{ category: string; count: number; average: number }>;
  }>(`/engagement/feedback?size=100${sp.category ? `&category=${sp.category}` : ''}`);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        {res.summary.map((s) => (
          <a
            key={s.category}
            href={`/engagement/feedback?category=${s.category}`}
            style={{ textDecoration: 'none' }}
          >
            <KpiTile
              label={e(`categories.${s.category}`)}
              value={`${s.average.toFixed(1)} / 5`}
              hint={`${s.count} ${e('count').toLowerCase()}`}
            />
          </a>
        ))}
      </div>
      <Card>
        <DataTable<FeedbackEntry>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'when',
              header: e('opened'),
              render: (f) => new Date(f.createdAt).toLocaleDateString('en-IN'),
            },
            {
              key: 'cat',
              header: e('feedbackCategory'),
              render: (f) => e(`categories.${f.category}`),
            },
            {
              key: 'rating',
              header: e('rating'),
              render: (f) => <Stars value={f.rating} />,
            },
            { key: 'comment', header: e('comment'), render: (f) => f.comment ?? '' },
            {
              key: 'author',
              header: e('author'),
              render: (f) => `${f.author}${f.student ? ` · ${f.student}` : ''}`,
            },
          ]}
          rows={res.data}
          rowKey={(f) => f.id}
          emptyTitle={e('noFeedback')}
        />
      </Card>
    </>
  );
}
