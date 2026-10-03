import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { OtpSignIn } from '@/components/OtpSignIn';
import { VisitorPhoto } from '@/components/VisitorPhoto';
import {
  COOKIE,
  PublicApiError,
  VISIT_STATE,
  langOf,
  publicFetch,
  t,
  todayIst,
  visitFetch,
  whenIst,
  type Visit,
  type VisitInfo,
  type VisitSlots,
} from '@/lib/api';
import { bookVisit, cancelVisit } from './actions';

const DAYS: Array<[string, string]> = [
  ['Mon', 'सोम'],
  ['Tue', 'मंगल'],
  ['Wed', 'बुध'],
  ['Thu', 'गुरु'],
  ['Fri', 'शुक्र'],
  ['Sat', 'शनि'],
  ['Sun', 'रवि'],
];

/**
 * Book an appointment with the school (0059): the page behind the school's QR code. The visitor confirms
 * the mobile with a one-time code, picks whom to meet, a day and a free slot, and gives the details the
 * school asks for. Confirmed appointments show their gate pass here.
 */
export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{
    lang?: string;
    host?: string;
    date?: string;
    ok?: string;
    error?: string;
  }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  const info = await visitFetch<VisitInfo>(`/${school}`, {}, null);
  const token = (await cookies()).get(COOKIE)?.value;
  let me: { name: string | null; mobile: string } | null = null;
  let visits: Visit[] = [];
  if (token) {
    try {
      [me, visits] = await Promise.all([
        publicFetch<{ name: string | null; mobile: string }>('/me'),
        visitFetch<{ data: Visit[] }>(`/${school}/mine`).then((r) => r.data),
      ]);
    } catch (error) {
      // a code for another school, or an expired sign-in: ask again
      if (!(error instanceof PublicApiError)) throw error;
      me = null;
    }
  }
  const host = info.hosts.find((h) => h.id === sp.host) ?? null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : '';
  const slots =
    me && host && date
      ? await visitFetch<VisitSlots>(
          `/${school}/slots?${new URLSearchParams({ hostId: host.id, date }).toString()}`,
          {},
          null,
        ).catch(() => null)
      : null;
  const last = new Date(Date.parse(`${todayIst()}T00:00:00Z`) + info.maxDaysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);
  /** Visiting hours on one line, the days with the same hours together: Mon–Sat 09:30–12:30. */
  const hoursOf = (h: VisitInfo['hosts'][number]) => {
    const name = (d: number) => DAYS[d - 1]![lang === 'hi' ? 1 : 0];
    const byTime = new Map<string, number[]>();
    for (const o of h.hours)
      byTime.set(`${o.starts}–${o.ends}`, [
        ...(byTime.get(`${o.starts}–${o.ends}`) ?? []),
        o.weekday,
      ]);
    return [...byTime.entries()]
      .map(([time, list]) => {
        const d = [...new Set(list)].sort((a, b) => a - b);
        const run = d.length > 2 && d.every((v, n) => n === 0 || v === d[n - 1]! + 1);
        return `${run ? `${name(d[0]!)}–${name(d[d.length - 1]!)}` : d.map(name).join(', ')} ${time}`;
      })
      .join(' · ');
  };
  const self = `/${school}/appointment?lang=${lang}`;
  return (
    <>
      <PageHeader
        kicker={info.school}
        title={t(lang, 'Book an appointment', 'मुलाक़ात का समय लें')}
        description={t(
          lang,
          'Confirm your mobile number, pick whom to meet and a free time. The school confirms and sends your gate pass.',
          'अपना मोबाइल नंबर पुष्ट करें, किससे मिलना है और खाली समय चुनें। विद्यालय पुष्टि करके गेट पास भेजेगा।',
        )}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/${school}/appointment?lang=${lang === 'hi' ? 'en' : 'hi'}`}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'cancelled'
            ? t(lang, 'Appointment cancelled.', 'मुलाक़ात रद्द की गई।')
            : t(
                lang,
                'Request sent. You will get a message when the school confirms it; your pass will show below.',
                'अनुरोध भेज दिया गया। विद्यालय की पुष्टि पर संदेश आएगा; आपका पास नीचे दिखेगा।',
              )}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error}
        </div>
      ) : null}
      {!info.enabled ? (
        <Card>
          {t(
            lang,
            'Online booking is closed at the moment. Please call the school office.',
            'ऑनलाइन बुकिंग अभी बंद है। कृपया विद्यालय कार्यालय को फ़ोन करें।',
          )}
        </Card>
      ) : !me ? (
        <>
          <Card
            title={t(
              lang,
              'Step 1: confirm your mobile number',
              'चरण 1: अपना मोबाइल नंबर पुष्ट करें',
            )}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <OtpSignIn school={school} lang={lang} returnTo={self} />
          </Card>
          <Card title={t(lang, 'Whom you can meet', 'आप किससे मिल सकते हैं')}>
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {info.hosts.map((h) => (
                <li key={h.id}>
                  <strong>{h.name}</strong>
                  <span className="ep-field__help"> · {hoursOf(h)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <>
          <Card
            title={t(lang, 'Whom to meet and when', 'किससे और कब मिलना है')}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <form method="get" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="lang" value={lang} />
              <label className="ep-field" htmlFor="v-host">
                <span className="ep-field__label">{t(lang, 'To meet', 'किससे मिलना है')}</span>
                <select
                  id="v-host"
                  name="host"
                  className="ep-select"
                  defaultValue={host?.id ?? ''}
                  required
                >
                  <option value="">{t(lang, 'Choose', 'चुनें')}</option>
                  {info.hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="v-date">
                <span className="ep-field__label">{t(lang, 'Day', 'दिन')}</span>
                <input
                  id="v-date"
                  name="date"
                  type="date"
                  className="ep-input"
                  required
                  min={todayIst()}
                  max={last}
                  defaultValue={date}
                />
              </label>
              <div>
                <Button type="submit" variant="secondary">
                  {t(lang, 'Show free times', 'खाली समय दिखाएँ')}
                </Button>
              </div>
            </form>
            {host ? (
              <p className="ep-field__help">
                {t(lang, 'Visiting hours', 'मिलने का समय')}: {hoursOf(host)}
                {host.location ? ` · ${host.location}` : ''}
              </p>
            ) : null}
            {info.instructions ? <p className="ep-field__help">{info.instructions}</p> : null}
          </Card>
          {slots?.closed ? (
            <div
              className="ep-alert ep-alert--warning"
              role="status"
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              {slots.closed}
            </div>
          ) : null}
          {host && slots && !slots.closed ? (
            <Card
              title={t(lang, 'Pick a time and tell us about you', 'समय चुनें और अपना विवरण दें')}
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              {slots.slots.some((x) => x.available) ? (
                <form action={bookVisit} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                  <input type="hidden" name="school" value={school} />
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="hostId" value={host.id} />
                  <input type="hidden" name="date" value={date} />
                  <fieldset className="ep-slots">
                    <legend className="ep-field__label">
                      {t(lang, 'Free times on', 'खाली समय')} {date}
                    </legend>
                    <div className="ep-slots__grid">
                      {slots.slots.map((x) => (
                        <label
                          key={x.time}
                          className="ep-slots__slot"
                          data-off={x.available ? undefined : ''}
                        >
                          <input
                            type="radio"
                            name="startsAt"
                            value={x.startsAt}
                            disabled={!x.available}
                            required
                          />
                          <span>{x.time}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="ep-field" htmlFor="v-name">
                    <span className="ep-field__label">
                      {t(lang, 'Your full name', 'आपका पूरा नाम')} *
                    </span>
                    <input
                      id="v-name"
                      name="visitorName"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={120}
                      defaultValue={me.name ?? ''}
                      autoComplete="name"
                    />
                  </label>
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    {t(lang, 'Mobile', 'मोबाइल')}: {me.mobile} {t(lang, '(confirmed)', '(पुष्ट)')}
                  </p>
                  <label className="ep-field" htmlFor="v-purpose">
                    <span className="ep-field__label">
                      {t(lang, 'Purpose of the visit', 'आने का कारण')} *
                    </span>
                    <input
                      id="v-purpose"
                      name="purpose"
                      className="ep-input"
                      required
                      minLength={3}
                      maxLength={500}
                      list="v-purposes"
                    />
                    <datalist id="v-purposes">
                      {info.purposes.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </label>
                  {info.ask.organisation !== 'off' ? (
                    <label className="ep-field" htmlFor="v-org">
                      <span className="ep-field__label">
                        {t(
                          lang,
                          'Organisation or place you come from',
                          'संस्था या स्थान जहाँ से आ रहे हैं',
                        )}
                        {info.ask.organisation === 'required' ? ' *' : ''}
                      </span>
                      <input
                        id="v-org"
                        name="visitorOrg"
                        className="ep-input"
                        maxLength={120}
                        required={info.ask.organisation === 'required'}
                      />
                    </label>
                  ) : null}
                  <label className="ep-field" htmlFor="v-party">
                    <span className="ep-field__label">
                      {t(
                        lang,
                        'How many people are coming (with you)',
                        'आपके साथ कुल कितने लोग आएँगे',
                      )}{' '}
                      *
                    </span>
                    <input
                      id="v-party"
                      name="partySize"
                      type="number"
                      className="ep-input"
                      min={1}
                      max={info.maxParty}
                      defaultValue={1}
                      required
                    />
                  </label>
                  {info.ask.idProof !== 'off' ? (
                    <>
                      <label className="ep-field" htmlFor="v-idkind">
                        <span className="ep-field__label">
                          {t(lang, 'ID proof you will carry', 'साथ लाने वाला पहचान पत्र')}
                          {info.ask.idProof === 'required' ? ' *' : ''}
                        </span>
                        <select
                          id="v-idkind"
                          name="idProofKind"
                          className="ep-select"
                          defaultValue=""
                          required={info.ask.idProof === 'required'}
                        >
                          <option value="">{t(lang, 'Choose', 'चुनें')}</option>
                          {info.idProofKinds.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ep-field" htmlFor="v-id4">
                        <span className="ep-field__label">
                          {t(lang, 'Last 4 characters of its number', 'उसके नंबर के अंतिम 4 अक्षर')}
                          {info.ask.idProof === 'required' ? ' *' : ''}
                        </span>
                        <input
                          id="v-id4"
                          name="idProofLast4"
                          className="ep-input"
                          pattern="[A-Za-z0-9]{4}"
                          maxLength={4}
                          required={info.ask.idProof === 'required'}
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
                    </>
                  ) : null}
                  {info.ask.photo !== 'off' ? (
                    <VisitorPhoto lang={lang} required={info.ask.photo === 'required'} />
                  ) : null}
                  <label className="ep-field" htmlFor="v-email">
                    <span className="ep-field__label">
                      {t(
                        lang,
                        'Email (optional, for the confirmation)',
                        'ईमेल (वैकल्पिक, पुष्टि के लिए)',
                      )}
                    </span>
                    <input
                      id="v-email"
                      name="visitorEmail"
                      type="email"
                      className="ep-input"
                      maxLength={200}
                      autoComplete="email"
                    />
                  </label>
                  <label className="ep-check" htmlFor="v-consent">
                    <input id="v-consent" name="consent" type="checkbox" required />{' '}
                    {t(
                      lang,
                      'I agree that the school keeps these details for this visit and its visitor record.',
                      'मैं सहमत हूँ कि विद्यालय यह विवरण इस मुलाक़ात और आगंतुक रिकॉर्ड के लिए रखे।',
                    )}
                  </label>
                  <div>
                    <Button type="submit">
                      {t(lang, 'Request the appointment', 'मुलाक़ात का अनुरोध भेजें')}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="ep-alert ep-alert--warning" role="status">
                  {t(
                    lang,
                    'No free time on this day. Please try another day.',
                    'इस दिन कोई समय खाली नहीं है। कृपया दूसरा दिन चुनें।',
                  )}
                </div>
              )}
            </Card>
          ) : null}
          <Card title={t(lang, 'Your appointments', 'आपकी मुलाक़ातें')}>
            {visits.length === 0 ? (
              <p className="ep-field__help">{t(lang, 'None yet.', 'अभी कोई नहीं।')}</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {visits.map((v) => {
                  const [en, hi, tone] = VISIT_STATE[v.state];
                  return (
                    <li
                      key={v.id}
                      style={{
                        padding: 'var(--sp-3) 0',
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 'var(--sp-2)',
                        }}
                      >
                        <strong>
                          {v.host ?? ''}
                          {v.startsAt ? ` · ${whenIst(v.startsAt, lang)}` : ''}
                        </strong>
                        <Badge tone={tone}>{t(lang, en, hi)}</Badge>
                      </div>
                      <div>{v.purpose}</div>
                      <div className="ep-kicker">
                        {v.number}
                        {v.place ? ` · ${v.place}` : ''}
                        {v.note ? ` · ${v.note}` : ''}
                      </div>
                      <div
                        style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}
                      >
                        {v.passLink ? (
                          <a
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            href={`${v.passLink}?lang=${lang}`}
                          >
                            {t(lang, 'Open the gate pass', 'गेट पास खोलें')}
                          </a>
                        ) : null}
                        {['requested', 'approved'].includes(v.state) ? (
                          <form action={cancelVisit}>
                            <input type="hidden" name="school" value={school} />
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="id" value={v.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label={`${t(lang, 'Cancel', 'रद्द करें')} ${v.number}`}
                            >
                              {t(lang, 'Cancel', 'रद्द करें')}
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
