import { Badge, Breadcrumbs, Card, DataTable, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { LessonPlan } from '@/lib/types';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function LessonPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, pl, p] = await Promise.all([
    getTranslations('pages.academics_lesson_plans'),
    getTranslations('planner'),
    apiFetch<LessonPlan>(`/academics/lesson-plans/${id}`),
  ]);
  const tone =
    p.status === 'approved'
      ? 'success'
      : p.status === 'submitted'
        ? 'warning'
        : p.status === 'rejected' || p.status === 'returned'
          ? 'danger'
          : 'neutral';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/academics/lesson-plans' },
          { label: t('title'), href: '/academics/lesson-plans' },
          { label: p.title },
        ]}
      />
      <PageHeader
        kicker={`${pl('week')} ${p.weekStart}`}
        title={p.title}
        description={`${p.teacher} · ${p.section} · ${p.subject}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            <Badge tone={tone}>{pl(`statuses.${p.status}`)}</Badge>
            {p.status === 'submitted' ? <a href="/workflow/inbox">{pl('openInbox')}</a> : null}
          </span>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={pl('objectives')}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.objectives ?? '—'}</p>
          {p.assessment ? (
            <p className="ep-field__help">
              <strong>{pl('assessment')}</strong>: {p.assessment}
            </p>
          ) : null}
          {p.decisionNote ? (
            <p className="ep-field__help">
              <strong>{pl('decision')}</strong>: {p.decisionNote}
            </p>
          ) : null}
        </Card>
        <Card title={pl('topics')}>
          <DataTable<LessonPlan['topics'][number]>
            caption={pl('topics')}
            density="dense"
            columns={[
              { key: 'day', header: pl('day'), render: (x) => DAYS[x.day] ?? String(x.day) },
              { key: 'topic', header: pl('topic'), render: (x) => <strong>{x.topic}</strong> },
              { key: 'activities', header: pl('activities'), render: (x) => x.activities ?? '' },
              { key: 'resources', header: pl('resources'), render: (x) => x.resources ?? '' },
              { key: 'homework', header: pl('homework'), render: (x) => x.homework ?? '' },
            ]}
            rows={p.topics}
            rowKey={(x) => String(x.day)}
            emptyTitle={pl('topics')}
          />
        </Card>
      </div>
    </>
  );
}
