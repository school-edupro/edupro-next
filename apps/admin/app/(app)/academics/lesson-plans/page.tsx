import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import type { LessonPlan, Page } from '@/lib/types';

export default async function LessonPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const [t, pl, page, me] = await Promise.all([
    getTranslations('pages.academics_lesson_plans'),
    getTranslations('planner'),
    apiFetch<Page<LessonPlan>>(
      `/academics/lesson-plans?size=100${sp.status ? `&status=${sp.status}` : ''}`,
    ),
    getMe(),
  ]);
  const tone = (s: LessonPlan['status']) =>
    s === 'approved'
      ? 'success'
      : s === 'submitted'
        ? 'warning'
        : s === 'rejected' || s === 'returned'
          ? 'danger'
          : 'neutral';
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <AcademicsNav current="/academics/lesson-plans" permissions={me.permissions} />
      <Card>
        <form
          method="get"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-3)',
          }}
        >
          <SelectField
            id="status"
            name="status"
            label={pl('status')}
            defaultValue={sp.status ?? ''}
            options={[
              { value: '', label: '—' },
              ...(['submitted', 'approved', 'returned', 'draft'] as const).map((s) => ({
                value: s,
                label: pl(`statuses.${s}`),
              })),
            ]}
          />
          <Button type="submit" variant="secondary">
            {pl('status')}
          </Button>
        </form>
        <DataTable<LessonPlan>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'week', header: pl('week'), render: (p) => p.weekStart },
            {
              key: 'title',
              header: pl('title'),
              render: (p) => (
                <a href={`/academics/lesson-plans/${p.id}`}>
                  <strong>{p.title}</strong>
                </a>
              ),
            },
            { key: 'teacher', header: pl('teacher'), render: (p) => p.teacher },
            { key: 'section', header: pl('section'), render: (p) => `${p.section} · ${p.subject}` },
            {
              key: 'status',
              header: pl('status'),
              render: (p) => <Badge tone={tone(p.status)}>{pl(`statuses.${p.status}`)}</Badge>,
            },
            {
              key: 'updated',
              header: '',
              render: (p) => new Date(p.updatedAt).toLocaleDateString('en-IN'),
            },
          ]}
          rows={page.data}
          rowKey={(p) => p.id}
          emptyTitle={pl('noPlans')}
        />
      </Card>
    </>
  );
}
