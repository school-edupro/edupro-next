import { Card, PageHeader } from '@edupro/ui';
import { currentLang, t } from '@/lib/i18n';

/** Served by the service worker when a page is not cached and the network is down (S11 PWA offline shell). */
export default async function OfflinePage() {
  const lang = await currentLang();
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader kicker="EduPro" title={t(lang, 'You are offline')} />
      <Card>
        <p>
          {t(
            lang,
            'The page you asked for is not saved on this device. Check your connection and try again.',
          )}
        </p>
        <a className="ep-btn ep-btn--primary" href="/">
          {t(lang, 'Try again')}
        </a>
      </Card>
    </main>
  );
}
