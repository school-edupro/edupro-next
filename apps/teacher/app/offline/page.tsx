import { Card, PageHeader } from '@edupro/ui';

/** Served by the service worker when a page is not cached and the network is down (S11 PWA offline shell). */
export default function OfflinePage() {
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader kicker="EduPro" title="You are offline" />
      <Card>
        <p>
          The page you asked for is not saved on this device. Check your connection and try again.
        </p>
        <a className="ep-btn ep-btn--primary" href="/">
          Try again
        </a>
      </Card>
    </main>
  );
}
