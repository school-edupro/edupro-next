import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { MyAssets } from '@/lib/purchase';
import { acknowledgeAssetMove } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(`${iso}T00:00:00+05:30`))
    : '';

/** The school's assets in my care, and those handed to me to acknowledge (docs/design/84, part 9). */
export default async function MyAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: MyAssets;
  try {
    data = await bff.api.fetch<MyAssets>('/purchase/assets-mine');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const kept = data.rows.filter((a) => !data.pending.some((p) => p.assetId === a.id));
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Home')}
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title={t(lang, 'Assets in my care')}
        description="The school’s assets you keep. They come back before you leave the school (the no-dues clearance lists them)."
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
        {data.pending.map((p) => (
          <Card key={p.movementId} title={`${p.tag} · ${p.item}`}>
            <p style={{ marginTop: 0 }}>
              <Badge tone="warning">{t(lang, 'Handed to you')}</Badge>
              {p.from ? ` by ${p.from}` : ''} on {when(p.movedOn)}
              {p.note ? ` · ${p.note}` : ''}
            </p>
            <form>
              <input type="hidden" name="movementId" value={p.movementId} />
              <label className="ep-field" htmlFor={`ack-${p.movementId}`}>
                <span className="ep-field__label">Note (its condition, anything missing)</span>
                <input
                  id={`ack-${p.movementId}`}
                  name="note"
                  className="ep-input"
                  maxLength={300}
                />
              </label>
              <button
                type="submit"
                formAction={acknowledgeAssetMove}
                className="ep-btn ep-btn--primary"
                style={{ marginTop: 'var(--sp-3)' }}
              >
                {t(lang, 'Acknowledge: I have it')}
              </button>
            </form>
          </Card>
        ))}
        {kept.length ? (
          <Card title={`${String(kept.length)} in your care`}>
            <ul style={{ margin: 0 }}>
              {kept.map((a) => (
                <li key={a.id}>
                  <strong>{a.tag}</strong> {a.item}
                  {a.serialNo ? ` · S/N ${a.serialNo}` : ''}
                  {a.location ? ` · ${a.location}` : ''} · {a.statusLabel}
                  {a.warrantyUntil ? ` · warranty until ${when(a.warrantyUntil)}` : ''}
                </li>
              ))}
            </ul>
          </Card>
        ) : data.pending.length ? null : (
          <Card>No asset is in your care.</Card>
        )}
      </div>
    </main>
  );
}
