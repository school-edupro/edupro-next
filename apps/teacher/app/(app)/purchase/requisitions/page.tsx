import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { inr, TIER, type RequisitionRow } from '@/lib/purchase';

/**
 * Purchase Requisitions in the staff app (docs/design/83, part 3): those waiting for my approval, and
 * the comparative statements waiting for my signature as a member of the purchase committee.
 */
export default async function StaffRequisitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let waiting: { data: RequisitionRow[] };
  let sign: { data: RequisitionRow[] };
  try {
    [waiting, sign] = await Promise.all([
      bff.api.fetch<{ data: RequisitionRow[] }>(
        '/purchase/requisitions?view=waiting&status=submitted&size=50',
      ),
      bff.api.fetch<{ data: RequisitionRow[] }>('/purchase/requisitions?view=sign&size=50'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const card = (x: RequisitionRow, label: string) => (
    <Card key={x.id} title={`${x.number} · ${x.department ?? ''}`}>
      <p style={{ marginTop: 0 }}>
        <strong>{inr(x.estimate)}</strong> · {x.tier ? TIER[x.tier].label : ''} · {x.lines}{' '}
        {x.lines === 1 ? 'line' : 'lines'}
      </p>
      {x.purpose ? <p>{x.purpose}</p> : null}
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/purchase/requisitions/${x.id}`}>
        {label}
      </a>
    </Card>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Purchase requisitions')}
        description={t(
          lang,
          'Requisitions waiting for your approval, and comparative statements for the purchase committee to sign.',
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
      <h2 className="ep-cdash__h3">{t(lang, 'Waiting for your approval')}</h2>
      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        {waiting.data.length ? (
          waiting.data.map((x) => card(x, t(lang, 'Open and decide')))
        ) : (
          <Card>{t(lang, 'Nothing is waiting for your approval.')}</Card>
        )}
      </div>
      {sign.data.length ? (
        <>
          <h2 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
            {t(lang, 'Comparative statements to sign')}
          </h2>
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {sign.data.map((x) => card(x, t(lang, 'Open and sign')))}
          </div>
        </>
      ) : null}
    </main>
  );
}
