import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import {
  PublicApiError,
  VISIT_EVENT,
  VISIT_STATE,
  langOf,
  maskMobile,
  svgSrc,
  t,
  visitFetch,
  whenIst,
  type VisitDetail,
} from '@/lib/api';
import { cancelVisit } from '../actions';

/**
 * One of the visitor's own appointments: everything they filled in, what the school decided, the history
 * and, once confirmed, the pass with its barcode and QR.
 */
export default async function VisitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school, id } = await params;
  const lang = langOf((await searchParams).lang);
  let v: VisitDetail;
  try {
    v = await visitFetch<VisitDetail>(`/${school}/mine/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 401)
      redirect(`/${school}/appointment?lang=${lang}`);
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  const [en, hi, tone] = VISIT_STATE[v.state];
  const facts: Array<[string, string | null]> = [
    [t(lang, 'Name', 'नाम'), v.visitorName],
    [t(lang, 'Mobile', 'मोबाइल'), v.visitorMobile ? maskMobile(v.visitorMobile) : null],
    [t(lang, 'Email', 'ईमेल'), v.visitorEmail],
    [t(lang, 'Coming from', 'कहाँ से'), v.visitorOrg],
    [t(lang, 'People', 'लोग'), String(v.partySize)],
    [
      t(lang, 'ID proof', 'पहचान पत्र'),
      v.idProofKind ? `${v.idProofKind}${v.idProofLast4 ? ` …${v.idProofLast4}` : ''}` : null,
    ],
    [t(lang, 'To meet', 'किससे मिलना है'), v.host],
    [t(lang, 'When', 'कब'), v.startsAt ? whenIst(v.startsAt, lang) : null],
    [t(lang, 'Where', 'कहाँ'), v.place],
    [t(lang, 'Purpose', 'कारण'), v.purpose],
    [t(lang, 'Requested on', 'अनुरोध की तिथि'), whenIst(v.createdAt, lang)],
    [t(lang, 'Note from the school', 'विद्यालय की टिप्पणी'), v.note],
  ];
  return (
    <>
      <PageHeader
        kicker={`${t(lang, 'Appointment', 'मुलाक़ात')} ${v.number}`}
        title={v.host ?? t(lang, 'Appointment', 'मुलाक़ात')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={tone}>{t(lang, en, hi)}</Badge>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/${school}/appointment?lang=${lang}`}
            >
              {t(lang, 'Back', 'वापस')}
            </a>
          </span>
        }
      />
      <Card
        title={t(lang, 'What you filled in', 'आपने जो भरा')}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {v.hasPhoto ? (
          <img
            className="ep-appt__photo"
            src={`/api/visit-photo/${school}/${v.id}`}
            alt={t(lang, 'Your photo', 'आपकी फ़ोटो')}
          />
        ) : null}
        <dl className="ep-hd__facts">
          {facts
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{x}</dd>
              </div>
            ))}
        </dl>
        {['requested', 'approved'].includes(v.state) ? (
          <form action={cancelVisit} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="school" value={school} />
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="id" value={v.id} />
            <Button type="submit" variant="ghost" size="sm">
              {t(lang, 'Cancel this appointment', 'यह मुलाक़ात रद्द करें')}
            </Button>
          </form>
        ) : null}
      </Card>
      {v.passQr ? (
        <Card title={t(lang, 'Gate pass', 'गेट पास')} style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-appt__poster">
            <img src={svgSrc(v.passQr)} alt={t(lang, 'QR code of the pass', 'पास का क्यूआर कोड')} />
            {v.barcode ? (
              <img
                className="ep-appt__barcode"
                src={svgSrc(v.barcode)}
                alt={t(lang, 'Barcode of the pass', 'पास का बारकोड')}
              />
            ) : null}
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/visit-card/${school}/${v.id}`}
            >
              {t(lang, 'Download the visitor card (PDF)', 'आगंतुक कार्ड डाउनलोड करें (PDF)')}
            </a>
            <p className="ep-field__help">
              {t(
                lang,
                'Show this at the gate on the day of the appointment with the ID proof you named.',
                'मुलाक़ात के दिन गेट पर यह और बताया हुआ पहचान पत्र दिखाएँ।',
              )}
            </p>
          </div>
        </Card>
      ) : null}
      <Card title={t(lang, 'History', 'इतिहास')}>
        <ul className="ep-hd__timeline">
          {v.events.map((e, i) => {
            const [a, b] = VISIT_EVENT[e.kind] ?? [e.kind, e.kind];
            return (
              <li key={i}>
                <span>
                  {t(lang, a, b)}
                  {e.startsAt ? ` · ${e.startsAt.replace('T', ' ')}` : ''}
                  {e.reason ? ` · ${e.reason}` : ''}
                </span>
                <span className="ep-field__help">{whenIst(e.at, lang)}</span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
