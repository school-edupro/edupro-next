import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import {
  PublicApiError,
  VISIT_STATE,
  langOf,
  svgSrc,
  t,
  visitFetch,
  whenIst,
  type Visit,
} from '@/lib/api';

type Pass = Visit & { school: string; instructions: string | null; visitorOrg: string | null };

/**
 * The gate pass behind the link in the confirmation message, laid out like the visitor card: who is
 * coming, from where, how many, why and to whom, with the barcode and the QR the gate scans.
 */
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
          <p className="ep-kicker" style={{ margin: 0 }}>
            {t(lang, 'VISITOR', 'आगंतुक')} · {pass.number}
          </p>
          <p className="ep-pass__name">
            {pass.visitorName}
            {pass.partySize > 1 ? ` + ${String(pass.partySize - 1)}` : ''}
          </p>
          <dl className="ep-hd__facts ep-pass__facts">
            {(
              [
                [t(lang, 'Coming from', 'कहाँ से'), pass.visitorOrg],
                [t(lang, 'To meet', 'किससे मिलना है'), pass.host],
                [t(lang, 'When', 'कब'), pass.startsAt ? whenIst(pass.startsAt, lang) : null],
                [t(lang, 'Where', 'कहाँ'), pass.place],
                [t(lang, 'Purpose', 'कारण'), pass.purpose],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {pass.passQr ? (
            <>
              <img
                src={svgSrc(pass.passQr)}
                alt={t(lang, 'QR code of this pass', 'इस पास का क्यूआर कोड')}
              />
              {pass.barcode ? (
                <img
                  className="ep-appt__barcode"
                  src={svgSrc(pass.barcode)}
                  alt={t(lang, 'Barcode of this pass', 'इस पास का बारकोड')}
                />
              ) : null}
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/pass-card/${school}/${encodeURIComponent(code)}`}
              >
                {t(lang, 'Download the visitor card (PDF)', 'आगंतुक कार्ड डाउनलोड करें (PDF)')}
              </a>
            </>
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
          {pass.instructions ? <p className="ep-field__help">{pass.instructions}</p> : null}
          <p className="ep-field__help">
            {t(
              lang,
              'Show this at the gate on the day of the appointment with the ID proof you named.',
              'मुलाक़ात के दिन गेट पर यह और बताया हुआ पहचान पत्र दिखाएँ।',
            )}
          </p>
        </div>
      </Card>
    </>
  );
}
