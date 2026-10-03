import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { OtpSignIn } from '@/components/OtpSignIn';
import { VisitorCamera } from '@/components/VisitorCamera';
import {
  COOKIE,
  PublicApiError,
  gateFetch,
  langOf,
  maskMobile,
  publicFetch,
  svgSrc,
  t,
} from '@/lib/api';
import { registerAtGate } from './actions';

interface Options {
  school: string;
  enabled: boolean;
  types: string[];
  idProofKinds: string[];
  purposes: string[];
  hosts: Array<{ id: string; name: string }>;
}
interface Mine {
  current: {
    number: string;
    passCode: string | null;
    state: 'waiting' | 'inside';
    visitorName: string;
    toMeet: string | null;
    purpose: string;
    barcode: string;
  } | null;
  profile: {
    visitorName: string;
    organisation: string | null;
    visitorType: string | null;
    email: string | null;
    idProofKind: string | null;
    idProofLast4: string | null;
    vehicleNo: string | null;
  } | null;
}

/**
 * A walk-in visitor at the gate (no appointment) fills their own details on their phone (0065): the
 * mobile is confirmed by a one-time code, the form comes filled in from the last visit, the photo is
 * taken live. The entry then waits for the guard, who checks the ID and lets the visitor in.
 */
export default async function GateVisitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ lang?: string; ok?: string; error?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  let o: Options;
  try {
    o = await gateFetch<Options>(`/${school}`, {}, null);
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  const token = (await cookies()).get(COOKIE)?.value;
  let me: { mobile: string } | null = null;
  let mine: Mine = { current: null, profile: null };
  if (token) {
    try {
      [me, mine] = await Promise.all([
        publicFetch<{ mobile: string }>('/me'),
        gateFetch<Mine>(`/${school}/mine`),
      ]);
    } catch (error) {
      if (!(error instanceof PublicApiError)) throw error;
      me = null;
    }
  }
  const self = `/${school}/visitor?lang=${lang}`;
  const p = mine.profile;
  return (
    <>
      <PageHeader
        kicker={o.school}
        title={t(lang, 'Visitor pass', 'आगंतुक पास')}
        description={t(
          lang,
          'At the gate without an appointment? Fill your details here and show the pass to the guard.',
          'बिना अपॉइंटमेंट गेट पर हैं? अपना विवरण यहाँ भरें और गार्ड को पास दिखाएँ।',
        )}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/${school}/appointment?lang=${lang}`}
            >
              {t(lang, 'Book an appointment', 'मुलाक़ात बुक करें')}
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/${school}/visitor?lang=${lang === 'hi' ? 'en' : 'hi'}`}
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </a>
          </span>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error}
        </div>
      ) : null}
      {!o.enabled ? (
        <Card>
          {t(
            lang,
            'Please register with the guard at the gate.',
            'कृपया गेट पर गार्ड के पास पंजीकरण कराएँ।',
          )}
        </Card>
      ) : !me ? (
        <Card title={t(lang, 'Enter your mobile number', 'अपना मोबाइल नंबर दर्ज करें')}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {t(
              lang,
              'We send a one-time code to confirm it.',
              'पुष्टि के लिए हम एक बार का कोड भेजते हैं।',
            )}
          </p>
          <OtpSignIn school={school} lang={lang} returnTo={self} askName={false} />
        </Card>
      ) : (
        <>
          <form
            method="post"
            action={`/api/logout?to=${encodeURIComponent(self)}`}
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <span className="ep-field__help">
              {t(lang, 'Signed in with mobile', 'इस मोबाइल से साइन इन')} {maskMobile(me.mobile)}.{' '}
              {t(lang, 'Not you?', 'यह आप नहीं हैं?')}
            </span>
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              {t(lang, 'Sign out', 'साइन आउट')}
            </button>
          </form>
          {mine.current ? (
            <Card
              title={t(lang, 'Your visitor pass', 'आपका आगंतुक पास')}
              actions={
                <Badge tone={mine.current.state === 'inside' ? 'success' : 'warning'}>
                  {mine.current.state === 'inside'
                    ? t(lang, 'Let in', 'प्रवेश मिला')
                    : t(lang, 'Show this to the guard', 'यह गार्ड को दिखाएँ')}
                </Badge>
              }
            >
              <div className="ep-appt__poster">
                <p className="ep-kicker" style={{ margin: 0 }}>
                  {mine.current.number}
                </p>
                <p className="ep-pass__name">{mine.current.visitorName}</p>
                <p style={{ margin: 0 }}>
                  {[mine.current.toMeet, mine.current.purpose].filter(Boolean).join(' · ')}
                </p>
                <img
                  className="ep-appt__barcode"
                  src={svgSrc(mine.current.barcode)}
                  alt={t(lang, 'Barcode of your pass', 'आपके पास का बारकोड')}
                />
                <p className="ep-pass__name">{mine.current.passCode}</p>
                <p className="ep-field__help">
                  {mine.current.state === 'inside'
                    ? t(
                        lang,
                        'Please show this again when you leave.',
                        'जाते समय कृपया यह फिर दिखाएँ।',
                      )
                    : t(
                        lang,
                        'The guard checks your ID proof and lets you in.',
                        'गार्ड आपका पहचान पत्र देखकर आपको प्रवेश देगा।',
                      )}
                </p>
              </div>
            </Card>
          ) : (
            <Card title={t(lang, 'Your details', 'आपका विवरण')}>
              {p ? (
                <p className="ep-alert ep-alert--info" role="status" style={{ marginTop: 0 }}>
                  {t(
                    lang,
                    'Your details from last time are filled in. Check them, take a new photo and send.',
                    'पिछली बार का आपका विवरण भरा हुआ है। जाँच लें, नई फ़ोटो लें और भेजें।',
                  )}
                </p>
              ) : null}
              <form action={registerAtGate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <input type="hidden" name="school" value={school} />
                <input type="hidden" name="lang" value={lang} />
                <label className="ep-field" htmlFor="g-name">
                  <span className="ep-field__label">
                    {t(lang, 'Your full name', 'आपका पूरा नाम')} *
                  </span>
                  <input
                    id="g-name"
                    name="visitorName"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={p?.visitorName ?? ''}
                    autoComplete="name"
                  />
                </label>
                <label className="ep-field" htmlFor="g-type">
                  <span className="ep-field__label">{t(lang, 'You are a', 'आप हैं')} *</span>
                  <select
                    id="g-type"
                    name="visitorType"
                    className="ep-select"
                    required
                    defaultValue={
                      p?.visitorType && o.types.includes(p.visitorType) ? p.visitorType : ''
                    }
                  >
                    <option value="">{t(lang, 'Choose', 'चुनें')}</option>
                    {o.types.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="g-org">
                  <span className="ep-field__label">
                    {t(lang, 'Company or place you come from', 'कंपनी या स्थान जहाँ से आए हैं')}
                  </span>
                  <input
                    id="g-org"
                    name="organisation"
                    className="ep-input"
                    maxLength={120}
                    defaultValue={p?.organisation ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="g-host">
                  <span className="ep-field__label">{t(lang, 'To meet', 'किससे मिलना है')} *</span>
                  <select id="g-host" name="hostId" className="ep-select" required defaultValue="">
                    <option value="">{t(lang, 'Choose', 'चुनें')}</option>
                    {o.hosts.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="g-purpose">
                  <span className="ep-field__label">
                    {t(lang, 'Purpose of the visit', 'आने का कारण')} *
                  </span>
                  <input
                    id="g-purpose"
                    name="purpose"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    list="g-purposes"
                  />
                  <datalist id="g-purposes">
                    {o.purposes.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </label>
                <label className="ep-field" htmlFor="g-party">
                  <span className="ep-field__label">
                    {t(lang, 'How many people (with you)', 'आपके साथ कुल कितने लोग')} *
                  </span>
                  <input
                    id="g-party"
                    name="partySize"
                    type="number"
                    className="ep-input"
                    min={1}
                    max={50}
                    defaultValue={1}
                    required
                  />
                </label>
                <label className="ep-field" htmlFor="g-equipment">
                  <span className="ep-field__label">
                    {t(
                      lang,
                      'Equipment or material you carry in (if any)',
                      'साथ लाया गया सामान या उपकरण (यदि हो)',
                    )}
                  </span>
                  <input
                    id="g-equipment"
                    name="equipment"
                    className="ep-input"
                    maxLength={300}
                    placeholder={t(
                      lang,
                      'Laptop, tool kit, 2 cartons',
                      'लैपटॉप, टूल किट, 2 डिब्बे',
                    )}
                  />
                </label>
                <label className="ep-field" htmlFor="g-vehicle">
                  <span className="ep-field__label">
                    {t(lang, 'Vehicle number (if any)', 'वाहन संख्या (यदि हो)')}
                  </span>
                  <input
                    id="g-vehicle"
                    name="vehicleNo"
                    className="ep-input"
                    maxLength={20}
                    defaultValue={p?.vehicleNo ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="g-idkind">
                  <span className="ep-field__label">
                    {t(lang, 'ID proof you carry', 'साथ लाया पहचान पत्र')} *
                  </span>
                  <select
                    id="g-idkind"
                    name="idProofKind"
                    className="ep-select"
                    required
                    defaultValue={
                      p?.idProofKind && o.idProofKinds.includes(p.idProofKind) ? p.idProofKind : ''
                    }
                  >
                    <option value="">{t(lang, 'Choose', 'चुनें')}</option>
                    {o.idProofKinds.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="g-id4">
                  <span className="ep-field__label">
                    {t(lang, 'Last 4 characters of its number', 'उसके नंबर के अंतिम 4 अक्षर')} *
                  </span>
                  <input
                    id="g-id4"
                    name="idProofLast4"
                    className="ep-input"
                    pattern="[A-Za-z0-9]{4}"
                    maxLength={4}
                    required
                    defaultValue={p?.idProofLast4 ?? ''}
                    autoComplete="off"
                  />
                  <span className="ep-field__help">
                    {t(
                      lang,
                      'Only these 4 are kept; never give the full number here.',
                      'केवल ये 4 अक्षर रखे जाते हैं; यहाँ पूरा नंबर न दें।',
                    )}
                  </span>
                </label>
                <VisitorCamera lang={lang} required />
                <label className="ep-check" htmlFor="g-consent">
                  <input id="g-consent" name="consent" type="checkbox" required />{' '}
                  {t(
                    lang,
                    'I agree that the school keeps these details in its visitor record.',
                    'मैं सहमत हूँ कि विद्यालय यह विवरण अपने आगंतुक रिकॉर्ड में रखे।',
                  )}
                </label>
                <div>
                  <Button type="submit">
                    {t(lang, 'Get my visitor pass', 'मेरा आगंतुक पास बनाएँ')}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </>
      )}
    </>
  );
}
