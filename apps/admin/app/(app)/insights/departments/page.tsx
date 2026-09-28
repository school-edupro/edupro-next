import { Badge, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { DepartmentCard } from '@/lib/types';

/** Sprint 13 (AI track): one card per department; open when the caller holds one of its permissions. */
export default async function DepartmentsPage() {
  const [t, i, cards] = await Promise.all([
    getTranslations('pages.insights_departments'),
    getTranslations('insights'),
    apiFetch<{ data: DepartmentCard[] }>('/insights/departments').then((r) => r.data),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        {cards.map((c) => (
          <Card key={c.department} title={i(`departmentNames.${c.department}`)} elevated>
            <p className="ep-field__help">{i('reportsCount', { count: c.reports })}</p>
            {c.allowed ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href={`/insights/departments/${c.department}`}
              >
                {i('open')}
              </a>
            ) : (
              <Badge tone="neutral">{i('notAllowed')}</Badge>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
