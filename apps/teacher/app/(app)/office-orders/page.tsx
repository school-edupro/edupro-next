import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { NoticeFeed, type NoticeView } from '@/components/NoticeFeed';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/**
 * Office orders for the employee: the orders, circulars and notices the school published for staff, with their
 * attachments; the latest 10, then 10 more as the list scrolls. An order that asks for it is acknowledged here, in
 * place.
 */
export default async function OfficeOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const tab = sp.tab === 'all' ? 'all' : 'orders';
  let rows: NoticeView[] = [];
  let total = 0;
  try {
    const r = await bff.api.fetch<{ data: NoticeView[]; page: { total: number } }>(
      `/academics/notices?page=1&size=10${tab === 'orders' ? '&kind=office_order' : ''}`,
    );
    rows = r.data;
    total = r.page.total;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Communication"
        title="Office orders"
        description="Orders and circulars the school issued for staff."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Acknowledged.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        <a href="/office-orders" aria-current={tab === 'orders' ? 'page' : undefined}>
          Office orders
        </a>
        <a href="/office-orders?tab=all" aria-current={tab === 'all' ? 'page' : undefined}>
          All notices for staff
        </a>
      </nav>
      {rows.length === 0 ? (
        <Card>{t(lang, 'Nothing has been issued yet.')}</Card>
      ) : (
        <NoticeFeed
          key={tab}
          first={rows}
          more={rows.length < total}
          kind={tab === 'orders' ? 'office_order' : undefined}
          foot={{
            more: t(lang, 'Show more'),
            loading: t(lang, 'Loading…'),
            failed: t(lang, 'Could not load more.'),
            end: t(lang, 'That is everything.'),
          }}
          words={{
            kinds: {
              notice: t(lang, 'Notice'),
              circular: t(lang, 'Circular'),
              office_order: t(lang, 'Office order'),
            },
            pinned: t(lang, 'Pinned'),
            attachments: t(lang, 'Attachments'),
            acknowledge: t(lang, 'Acknowledge'),
            acknowledged: t(lang, 'You acknowledged this'),
            failed: t(lang, 'That did not work. Please try again.'),
          }}
        />
      )}
    </main>
  );
}
