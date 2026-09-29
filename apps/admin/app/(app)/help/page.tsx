import { Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { helpPages } from '@/lib/help';

/** Sprint 22: the help centre index (training pages synced from docs/training). */
export default async function HelpPage() {
  const [t, o] = await Promise.all([getTranslations('pages.help'), getTranslations('ops')]);
  const pages = helpPages();
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}
      >
        {pages.map((p) => (
          <Card
            key={p.slug}
            title={p.title}
            actions={
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/help/${p.slug}`}>
                {o('helpOpen')}
              </a>
            }
          >
            <p className="ep-field__help" style={{ margin: 0 }}>
              {p.summary}
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
