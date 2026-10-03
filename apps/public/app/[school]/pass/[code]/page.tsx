import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PublicApiError, VISIT_STATE, langOf, t, visitFetch, whenIst, type Visit } from '@/lib/api';

type Pass = Visit & { school: string; instructions: string | null };

/** The gate pass behind the link in the confirmation message: the QR code the gate scans. */
export default async function PassPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; code: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school, code } = await params;
  const lang = langOf((await searchParams).lang);
  let pass: Pass;
  try {
    pass = await visitFetch<Pass>(`/${school}/pass/${encodeURIComponent(code)}`, {}, null);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  const [en, hi, tone] = VISIT_STATE[pass.state];
  return (
    <>
      <PageHeader
        kicker={pass.school}
        title={t(lang, 'Gate pass', 'गेट पास')}
        actions={<Badge tone={tone}>{t(lang, en, hi)}</Badge>}
      />
      <Card>
        <div className="ep-appt__poster">
          {pass.passQr ? (
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(pass.passQr)}`}
              alt={t(lang, 'QR code of this pass', 'इस पास का क्यूआर कोड')}
            />
          ) : (
            <p className="ep-alert ep-alert--warning" role="status">
              {pass.state === 'requested'
                ? t(
                    lang,
                    'The school has not confirmed this appointment yet.',
                    'विद्यालय ने अभी इस मुलाक़ात की पुष्टि नहीं की है।',
                  )
                : t(lang, 'This pass is no longer valid.', 'यह पास अब मान्य नहीं है।')}
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong>{pass.number}</strong> · {pass.visitorName}
            {pass.partySize > 1 ? ` + ${String(pass.partySize - 1)}` : ''}
          </p>
          <p style={{ margin: 0 }}>
            {pass.host}
            {pass.startsAt ? ` · ${whenIst(pass.startsAt, lang)}` : ''}
            {pass.place ? ` · ${pass.place}` : ''}
          </p>
          {pass.instructions ? <p className="ep-field__help">{pass.instructions}</p> : null}
          <p className="ep-field__help">
            {t(
              lang,
              'Show this code at the gate with the ID proof you named.',
              'गेट पर यह कोड और बताया हुआ पहचान पत्र दिखाएँ।',
            )}
          </p>
        </div>
      </Card>
    </>
  );
}
