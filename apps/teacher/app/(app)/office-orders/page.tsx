import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { ackOrder } from '../daily-work/actions';

interface Notice {
  id: string;
  kind: 'notice' | 'circular' | 'office_order';
  title: string;
  body: string;
  bodyFormat: 'text' | 'html';
  publishFrom: string;
  publishedBy: string | null;
  isPinned: boolean;
  ackRequired: boolean;
  ackedByMe: boolean;
  files: Array<{ id: string; name: string | null }>;
}
const KIND: Record<string, string> = {
  notice: 'Notice',
  circular: 'Circular',
  office_order: 'Office order',
};
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Office orders for the employee: the orders, circulars and notices the school published for staff,
 * with their attachments. An order that asks for it is acknowledged here.
 */
export default async function OfficeOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'all' ? 'all' : 'orders';
  let rows: Notice[] = [];
  try {
    rows = (
      await bff.api.fetch<{ data: Notice[] }>(
        `/academics/notices?size=100${tab === 'orders' ? '&kind=office_order' : ''}`,
      )
    ).data;
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
        <Card>Nothing has been issued yet.</Card>
      ) : (
        rows.map((n) => (
          <Card
            key={n.id}
            title={n.title}
            style={{ marginBottom: 'var(--sp-3)' }}
            actions={
              <Badge tone={n.kind === 'office_order' ? 'info' : 'neutral'}>{KIND[n.kind]}</Badge>
            }
          >
            <p className="ep-kicker" style={{ marginTop: 0 }}>
              {day(n.publishFrom)}
              {n.publishedBy ? ` · ${n.publishedBy}` : ''}
            </p>
            {n.bodyFormat === 'html' ? (
              <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: n.body }} />
            ) : (
              <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
            )}
            {n.files.length ? (
              <p>
                <span className="ep-kicker">Attachments</span>{' '}
                {n.files.map((f, i) => (
                  <FileLinks
                    key={f.id}
                    url={`/api/doc-file/notice/${n.id}/${f.id}`}
                    saveUrl={`/api/doc-file/notice/${n.id}/${f.id}?save=1`}
                    label={`attachment ${String(i + 1)} of ${n.title}`}
                  />
                ))}
              </p>
            ) : null}
            {n.ackRequired ? (
              n.ackedByMe ? (
                <Badge tone="success">You acknowledged this</Badge>
              ) : (
                <form action={ackOrder}>
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    Acknowledge
                  </button>
                </form>
              )
            ) : null}
          </Card>
        ))
      )}
    </main>
  );
}
