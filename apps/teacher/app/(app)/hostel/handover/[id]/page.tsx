import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { HandoverPhoto } from '@/components/HandoverPhoto';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { handOver, sendHandoverCode } from '../../actions';

interface Leave {
  id: string;
  number: string;
  name: string;
  admissionNo: string;
  hostel: string | null;
  returnBy: string | null;
  reason: string;
  escortKind: string | null;
  escortName: string | null;
  escortRelation: string | null;
}

/**
 * The warden hands a pupil on home leave to the person collecting: compare with the photos on record, take
 * a live photo, and for someone not on the record confirm with the code sent to the parent and a remark.
 */
export default async function HandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await currentLang();
  let leave: Leave | undefined;
  try {
    leave = (await bff.api.fetch<{ data: Leave[] }>('/hostel/leaves?show=handover')).data.find(
      (l) => l.id === id,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  if (!leave)
    redirect(
      '/hostel?error=not-found&detail=' +
        encodeURIComponent('This leave is not waiting for hand-over today'),
    );
  const outsider = leave.escortKind === 'other';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Home leave')}
        title={`${t(lang, 'Hand over')} ${leave.name}`}
        description={`${leave.number} · ${leave.admissionNo} · ${leave.reason}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/hostel">
            {t(lang, 'Hostel desk')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card title={t(lang, 'Collected by')} style={{ marginBottom: 'var(--sp-3)' }}>
        <p>
          <strong>{leave.escortName ?? '—'}</strong>
          {leave.escortRelation ? ` (${leave.escortRelation})` : ''}
          {outsider
            ? ` · ${t(lang, 'not on the school record')}`
            : ` · ${t(lang, 'on the school record')}`}
        </p>
        {outsider ? (
          <form action={sendHandoverCode}>
            <input type="hidden" name="id" value={leave.id} />
            <p className="ep-field__help">
              {sp.sent
                ? `${t(lang, 'Code sent to the parent’s mobile ending')} ${sp.sent}. ${t(lang, 'Ask the parent to tell it to you.')}`
                : t(lang, 'Someone not on the record: send a one-time code to the parent first.')}
            </p>
            <Button type="submit" variant="secondary" size="sm">
              {sp.sent ? t(lang, 'Send the code again') : t(lang, 'Send the code to the parent')}
            </Button>
          </form>
        ) : null}
      </Card>
      <Card title={t(lang, 'Hand over')}>
        <form action={handOver} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <input type="hidden" name="id" value={leave.id} />
          <HandoverPhoto />
          {outsider ? (
            <>
              <label className="ep-field" htmlFor="ho-otp">
                <span className="ep-field__label">{t(lang, 'Code from the parent')} *</span>
                <input
                  id="ho-otp"
                  name="otp"
                  className="ep-input"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ho-remark">
                <span className="ep-field__label">
                  {t(lang, 'Remark (ID seen, parent spoken to)')} *
                </span>
                <input
                  id="ho-remark"
                  name="remark"
                  className="ep-input"
                  minLength={3}
                  maxLength={300}
                  required
                />
              </label>
            </>
          ) : null}
          <div>
            <Button type="submit">{t(lang, 'Hand over')}</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
