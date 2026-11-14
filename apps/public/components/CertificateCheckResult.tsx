import { Badge, Card } from '@edupro/ui';
import { t, type CertificateCheck, type Lang } from '@/lib/api';

const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** What a certificate check found (docs/design/87, phase D): valid, cancelled or not found, with the facts. */
export function CertificateCheckResult({ r, lang }: { r: CertificateCheck; lang: Lang }) {
  const x = r.certificate;
  const [tone, en, hi] =
    r.result === 'valid'
      ? (['success', 'Valid', 'मान्य'] as const)
      : r.result === 'cancelled'
        ? (['danger', 'Cancelled', 'रद्द'] as const)
        : (['warning', 'Not found', 'नहीं मिला'] as const);
  return (
    <Card>
      <div className="ep-certcheck" role="status" aria-live="polite">
        <p className="ep-certcheck__result">
          <Badge tone={tone}>{t(lang, en, hi)}</Badge>
        </p>
        {x ? (
          <dl className="ep-certcheck__facts">
            {(
              [
                [t(lang, 'Certificate', 'प्रमाणपत्र'), x.type],
                [
                  t(lang, 'Number', 'क्रमांक'),
                  x.copy
                    ? `${x.number} · ${t(lang, 'duplicate', 'प्रतिलिपि')} ${String(x.copy)}`
                    : x.number,
                ],
                [t(lang, 'Issued on', 'जारी करने की तिथि'), dmy(x.issuedOn)],
                [
                  x.holderKind === 'student'
                    ? t(lang, 'Student', 'विद्यार्थी')
                    : t(lang, 'Employee', 'कर्मचारी'),
                  x.holder,
                ],
                [t(lang, 'Issued by', 'जारीकर्ता'), r.school.name],
                ...(x.cancelledOn
                  ? [[t(lang, 'Cancelled on', 'रद्द करने की तिथि'), dmy(x.cancelledOn)]]
                  : []),
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>
            {t(
              lang,
              `No certificate of ${r.school.name} matches. Check the number and the date of issue as printed, or ask the school.`,
              `${r.school.name} का कोई प्रमाणपत्र मेल नहीं खाता। छपे हुए क्रमांक और तिथि जाँचें, या विद्यालय से पूछें।`,
            )}
          </p>
        )}
        {x?.legacy ? (
          <p className="ep-certcheck__note">
            {t(
              lang,
              'From the record of the school’s earlier system.',
              'विद्यालय की पिछली प्रणाली के रिकॉर्ड से।',
            )}
          </p>
        ) : null}
        {x && r.result === 'cancelled' ? (
          <p className="ep-certcheck__note">
            {t(
              lang,
              'The school has cancelled this certificate: it is not valid.',
              'विद्यालय ने यह प्रमाणपत्र रद्द कर दिया है: यह मान्य नहीं है।',
            )}
          </p>
        ) : null}
        <p className="ep-certcheck__note">
          {t(
            lang,
            'The name is shown in part. Compare the details with the paper in hand.',
            'नाम आंशिक रूप से दिखाया गया है। विवरण हाथ के कागज़ से मिलाएँ।',
          )}
        </p>
      </div>
    </Card>
  );
}
