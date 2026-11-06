import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { inr, type OrderRow } from '@/lib/purchase';

/** Purchase orders, and emergency purchases to ratify, waiting for my approval (docs/design/83). */
export default async function StaffOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: { data: OrderRow[] };
  try {
    data = await bff.api.fetch<{ data: OrderRow[] }>(
      '/purchase/orders?view=waiting&status=submitted&size=50',
    );
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
        title={t(lang, 'Purchase orders')}
        description={t(
          lang,
          'Orders waiting for your approval, and emergency purchases to ratify.',
        )}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {data.data.length ? (
          data.data.map((x) => (
            <Card key={x.id} title={`${x.label} · ${x.vendor}`}>
              <p style={{ marginTop: 0 }}>
                {x.emergency ? (
                  <>
                    <Badge tone="danger">Emergency</Badge>{' '}
                  </>
                ) : null}
                <strong>{inr(x.total)}</strong>
                {x.department ? ` · ${x.department}` : ''}
                {x.requisition ? ` · ${x.requisition}` : ''}
              </p>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/purchase/orders/${x.id}`}>
                {t(lang, 'Open and decide')}
              </a>
            </Card>
          ))
        ) : (
          <Card>{t(lang, 'Nothing is waiting for your approval.')}</Card>
        )}
      </div>
    </main>
  );
}
