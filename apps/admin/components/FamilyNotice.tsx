import { Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';

/** Shown instead of the staff shell when a parent or student signs in to the admin portal. */
export async function FamilyNotice({ name }: { name: string }) {
  const t = await getTranslations('familyNotice');
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface-band)',
        padding: 'var(--sp-5)',
      }}
    >
      <Card elevated style={{ width: '100%', maxWidth: '460px' }}>
        <div className="ep-kicker">{t('kicker')}</div>
        <h1 className="ep-page-title" style={{ marginBottom: 'var(--sp-2)' }}>
          {t('title', { name })}
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-5)' }}>{t('text')}</p>
        <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <a className="ep-btn ep-btn--primary" href={`${env.parentAppUrl}/login`}>
            {t('open')}
          </a>
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost" style={{ width: '100%' }}>
              {t('signOut')}
            </button>
          </form>
        </div>
      </Card>
    </main>
  );
}
