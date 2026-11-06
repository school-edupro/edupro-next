import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { ReceiptRow } from '@/lib/purchase';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${iso}T00:00:00+05:30`));

/** Goods and services received, waiting for my inspection or signature (docs/design/84, part 7). */
export default async function StaffReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: { rows: ReceiptRow[] };
  try {
    data = await bff.api.fetch<{ rows: ReceiptRow[] }>('/purchase/receipts?mine=1');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Goods received to inspect')}
        description={t(
          lang,
          'Goods and services your department received: check them and accept or reject.',
        )}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {data.rows.length ? (
          data.rows.map((x) => (
            <Card key={x.id} title={`${x.number} · ${x.vendor}`}>
              <p style={{ marginTop: 0 }}>
                {x.kind === 'service' ? 'Work done' : 'Received'} {when(x.receivedOn)} · {x.order}
                {x.department ? ` · ${x.department}` : ''}
                {x.createdBy ? ` · by ${x.createdBy}` : ''}
              </p>
              {x.overdue ? (
                <p>
                  <Badge tone="warning">Past 15 days</Badge> Counts as accepted from{' '}
                  {when(x.deemedOn)} (MSMED Act).
                </p>
              ) : null}
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/receipts/${x.id}`}
              >
                {t(lang, 'Open and inspect')}
              </a>
            </Card>
          ))
        ) : (
          <Card>{t(lang, 'Nothing is waiting for your inspection.')}</Card>
        )}
      </div>
    </main>
  );
}
