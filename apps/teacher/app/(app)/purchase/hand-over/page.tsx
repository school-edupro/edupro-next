import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { PurchaseDelegation } from '@/lib/purchase';
import { delegatePurchase, revokePurchaseDelegation } from '@/lib/purchase-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));

/** Hand my purchase approvals to a colleague for some days (docs/design/83, part 2). */
export default async function StaffHandOverPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let data: {
    data: PurchaseDelegation[];
    staff: Array<{ id: string; code: string; name: string; designation: string | null }>;
  };
  try {
    data = await bff.api.fetch('/purchase/delegations');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Purchase indents')}
        </a>
      </p>
      <PageHeader
        kicker={t(lang, 'Purchase indents')}
        title={t(lang, 'Hand over my approvals')}
        description={t(
          lang,
          'Away for some days? A colleague approves your purchase indents, requisitions and orders in your place for those days. Other approvals stay with you.',
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
      <Card>
        <form action={delegatePurchase} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="ho-to">
            <span className="ep-field__label">{t(lang, 'To')} *</span>
            <select id="ho-to" name="toEmployeeId" className="ep-select" required defaultValue="">
              <option value="">{t(lang, 'Pick the colleague')}</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}){s.designation ? ` · ${s.designation}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="ho-from">
            <span className="ep-field__label">{t(lang, 'From')} *</span>
            <input
              id="ho-from"
              name="startsOn"
              type="date"
              className="ep-input"
              required
              min={today}
              defaultValue={today}
            />
          </label>
          <label className="ep-field" htmlFor="ho-until">
            <span className="ep-field__label">{t(lang, 'To (the whole day)')} *</span>
            <input
              id="ho-until"
              name="endsOn"
              type="date"
              className="ep-input"
              required
              min={today}
            />
          </label>
          <label className="ep-field" htmlFor="ho-why">
            <span className="ep-field__label">{t(lang, 'Reason')} *</span>
            <input
              id="ho-why"
              name="reason"
              className="ep-input"
              required
              minLength={3}
              maxLength={300}
            />
          </label>
          <div>
            <button type="submit" className="ep-btn ep-btn--primary">
              {t(lang, 'Hand over')}
            </button>
          </div>
        </form>
      </Card>
      <div style={{ display: 'grid', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
        {data.data.map((d) => (
          <Card key={d.id} title={`${d.from} → ${d.to}`}>
            <p style={{ marginTop: 0 }}>
              {when(d.startsAt)} – {when(d.endsAt)} · {d.reason}{' '}
              <Badge tone={d.revoked ? 'neutral' : d.active ? 'success' : 'info'}>
                {d.revoked
                  ? 'Ended early'
                  : d.active
                    ? 'In force'
                    : new Date(d.startsAt) > new Date()
                      ? 'Starts later'
                      : 'Over'}
              </Badge>
            </p>
            {d.mine && !d.revoked && new Date(d.endsAt) > new Date() ? (
              <form action={revokePurchaseDelegation}>
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                  {t(lang, 'End now')}
                </button>
              </form>
            ) : null}
          </Card>
        ))}
      </div>
    </main>
  );
}
