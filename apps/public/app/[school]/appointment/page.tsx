import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { OtpSignIn } from '@/components/OtpSignIn';
import { VisitorCamera } from '@/components/VisitorCamera';
import {
  COOKIE,
  PublicApiError,
  VISIT_STATE,
  dateLabel,
  langOf,
  maskMobile,
  publicFetch,
  t,
  visitFetch,
  whenIst,
  type Visit,
  type VisitInfo,
  type VisitProfile,
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
 * The page behind the school's QR code (0059). A visitor confirms the mobile number with a one-time code
 * (nothing else is asked first). Someone who has booked before sees their appointments and passes at
 * once; booking is three taps (whom to meet, an open day, a time) and a form that comes filled in from
 * the last visit, with a photo taken live. On the school's own tablet (kiosk) each visitor is signed out
 * once the request is in.
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
    book?: string;
    kiosk?: string;
    no?: string;
    ok?: string;
    error?: string;
  }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  const kiosk = sp.kiosk === '1';
  const info = await visitFetch<VisitInfo>(`/${school}`, {}, null);
  const token = (await cookies()).get(COOKIE)?.value;
  let me: { name: string | null; mobile: string } | null = null;
  let visits: Visit[] = [];
  let profile: VisitProfile | null = null;
  if (token) {
    try {
      const [who, mine] = await Promise.all([
        publicFetch<{ name: string | null; mobile: string }>('/me'),
        visitFetch<{ data: Visit[]; profile: VisitProfile | null }>(`/${school}/mine`),
      ]);
      me = who;
      visits = mine.data;
      profile = mine.profile;
    } catch (error) {
      // a code for another school, or an expired sign-in: ask again
      if (!(error instanceof PublicApiError)) throw error;
      me = null;
    }
  }
  // someone with appointments sees them first; Book another (or the kiosk) opens the booking steps
  const booking =
    Boolean(me) && (kiosk || visits.length === 0 || sp.book === '1' || Boolean(sp.host));
  const host = booking ? (info.hosts.find((h) => h.id === sp.host) ?? null) : null;
  const days = host
    ? await visitFetch<{ data: Array<{ date: string }>; note: string | null }>(
        `/${school}/days?hostId=${host.id}`,
        {},
        null,
      ).catch(() => ({ data: [], note: t(lang, 'Please try again.', 'कृपया फिर कोशिश करें।') }))
    : null;
  const date = days?.data.some((d) => d.date === sp.date) ? sp.date! : '';
  const slots =
    host && date
      ? await visitFetch<VisitSlots>(
          `/${school}/slots?${new URLSearchParams({ hostId: host.id, date }).toString()}`,
          {},
          null,
        ).catch(() => null)
      : null;
  const name = (d: number) => DAYS[d - 1]![lang === 'hi' ? 1 : 0];
  /** Visiting hours on one line, the days with the same hours together: Mon–Sat 09:30–12:30. */
  const hoursOf = (h: VisitInfo['hosts'][number]) => {
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
  /** This page with some of the answers kept. */
  const at = (extra: Record<string, string>) =>
    `/${school}/appointment?${new URLSearchParams({
      lang,
      ...(kiosk ? { kiosk: '1' } : {}),
      ...extra,
    }).toString()}`;
  const self = at({});
  const step = (n: number, label: string) => (
    <h2 className="ep-step ep-step--open">
      <span className="ep-step__no" aria-hidden="true">
        {n}
      </span>
      <span className="ep-step__label">{label}</span>
    </h2>
  );
  const done = (n: number, label: string, value: string, change: string) => (
    <div className="ep-step ep-step--done">
      <span className="ep-step__no" aria-hidden="true">
        {n}
      </span>
      <span className="ep-step__label">{label}</span>
      <strong>{value}</strong>
      <a href={change} aria-label={`${t(lang, 'Change', 'बदलें')}: ${label}`}>
        {t(lang, 'Change', 'बदलें')}
      </a>
    </div>
  );
  return (
    <>
      <PageHeader
        kicker={info.school}
        title={t(lang, 'Appointments', 'मुलाक़ात')}
        description={t(
          lang,
          'Book a time to meet the school, or see the appointment you already booked.',
          'विद्यालय से मिलने का समय लें, या अपनी पहले से बुक की हुई मुलाक़ात देखें।',
        )}
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/${school}/appointment?lang=${lang === 'hi' ? 'en' : 'hi'}${kiosk ? '&kiosk=1' : ''}`}
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
            : kiosk
              ? `${t(lang, 'Request sent. Your appointment number is', 'अनुरोध भेज दिया गया। आपका मुलाक़ात नंबर है')} ${(sp.no ?? '').replace(/[^A-Za-z0-9-]/g, '')}. ${t(
                  lang,
                  'You will get a message with your gate pass when the school confirms it. You have been signed out of this device.',
                  'विद्यालय की पुष्टि पर गेट पास के साथ संदेश आएगा। इस डिवाइस से आपको साइन आउट कर दिया गया है।',
                )}`
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
            title={t(lang, 'Enter your mobile number', 'अपना मोबाइल नंबर दर्ज करें')}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {t(
                lang,
                'We send a one-time code to confirm it. If you booked before, use the same number to see your appointment and gate pass.',
                'पुष्टि के लिए हम एक बार का कोड भेजते हैं। अगर आपने पहले बुक किया है, तो अपनी मुलाक़ात और गेट पास देखने के लिए वही नंबर डालें।',
              )}
            </p>
            <OtpSignIn school={school} lang={lang} returnTo={self} askName={false} />
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
          {!kiosk && visits.length ? (
            <Card
              title={t(lang, 'Your appointments', 'आपकी मुलाक़ातें')}
              style={{ marginBottom: 'var(--sp-4)' }}
              actions={
                booking ? null : (
                  <a className="ep-btn ep-btn--primary ep-btn--sm" href={at({ book: '1' })}>
                    {t(lang, 'Book another', 'एक और बुक करें')}
                  </a>
                )
              }
            >
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
                      <div className="ep-apt__top">
                        <a
                          className="ep-apt__title"
                          href={`/${school}/appointment/${v.id}?lang=${lang}`}
                        >
                          {v.host ?? ''}
                          {v.startsAt ? ` · ${whenIst(v.startsAt, lang)}` : ''}
                        </a>
                        <Badge tone={tone}>{t(lang, en, hi)}</Badge>
                      </div>
                      <div>{v.purpose}</div>
                      <div className="ep-kicker">
                        {v.number}
                        {v.place ? ` · ${v.place}` : ''}
                        {v.note ? ` · ${v.note}` : ''}
                      </div>
                      <div className="ep-apt__actions">
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`/${school}/appointment/${v.id}?lang=${lang}`}
                          aria-label={`${t(lang, v.passLink ? 'Details and gate pass' : 'Details', v.passLink ? 'विवरण और गेट पास' : 'विवरण')} ${v.number}`}
                        >
                          {t(
                            lang,
                            v.passLink ? 'Details and gate pass' : 'Details',
                            v.passLink ? 'विवरण और गेट पास' : 'विवरण',
                          )}
                        </a>
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
            </Card>
          ) : null}
          {booking ? (
            <Card title={t(lang, 'Book an appointment', 'मुलाक़ात बुक करें')}>
              {/* 1: whom to meet */}
              {host ? (
                done(1, t(lang, 'To meet', 'किससे मिलना है'), host.name, at({ book: '1' }))
              ) : (
                <>
                  {step(1, t(lang, 'Whom do you want to meet?', 'आप किससे मिलना चाहते हैं?'))}
                  <div className="ep-choices">
                    {info.hosts.map((h) => (
                      <a key={h.id} className="ep-choice" href={at({ host: h.id })}>
                        <strong>{h.name}</strong>
                        <span>{hoursOf(h)}</span>
                        {h.location ? <span>{h.location}</span> : null}
                      </a>
                    ))}
                  </div>
                </>
              )}
              {/* 2: the day */}
              {host && date
                ? done(2, t(lang, 'Day', 'दिन'), dateLabel(date, lang), at({ host: host.id }))
                : null}
              {host && !date && days ? (
                <>
                  {step(2, t(lang, 'Pick a day', 'दिन चुनें'))}
                  {days.data.length ? (
                    <div className="ep-choices ep-choices--days">
                      {days.data.map((d) => (
                        <a
                          key={d.date}
                          className="ep-choice"
                          href={at({ host: host.id, date: d.date })}
                        >
                          <strong>{dateLabel(d.date, lang)}</strong>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-alert ep-alert--warning" role="status">
                      {days.note}
                    </div>
                  )}
                </>
              ) : null}
              {/* 3: the time and the visitor */}
              {host && date && slots ? (
                <>
                  {step(
                    3,
                    t(lang, 'Pick a time and check your details', 'समय चुनें और अपना विवरण जाँचें'),
                  )}
                  {slots.closed || !slots.slots.some((x) => x.available) ? (
                    <div className="ep-alert ep-alert--warning" role="status">
                      {slots.closed ??
                        t(
                          lang,
                          'No free time on this day. Please pick another day.',
                          'इस दिन कोई समय खाली नहीं है। कृपया दूसरा दिन चुनें।',
                        )}
                    </div>
                  ) : (
                    <form action={bookVisit} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                      <input type="hidden" name="school" value={school} />
                      <input type="hidden" name="lang" value={lang} />
                      {kiosk ? <input type="hidden" name="kiosk" value="1" /> : null}
                      <input type="hidden" name="hostId" value={host.id} />
                      <input type="hidden" name="date" value={date} />
                      <fieldset className="ep-slots">
                        <legend className="ep-field__label">
                          {t(lang, 'Free times on', 'खाली समय')} {dateLabel(date, lang)} *
                        </legend>
                        <div className="ep-slots__grid">
                          {slots.slots
                            .filter((x) => x.available)
                            .map((x) => (
                              <label key={x.time} className="ep-slots__slot">
                                <input type="radio" name="startsAt" value={x.startsAt} required />
                                <span>{x.time}</span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                      {profile && !kiosk ? (
                        <p className="ep-alert ep-alert--info" role="status" style={{ margin: 0 }}>
                          {t(
                            lang,
                            'Your details from last time are filled in. Check them, take a new photo and send.',
                            'पिछली बार का आपका विवरण भरा हुआ है। जाँच लें, नई फ़ोटो लें और भेजें।',
                          )}
                        </p>
                      ) : null}
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
                          defaultValue={profile?.visitorName ?? me.name ?? ''}
                          autoComplete="name"
                        />
                      </label>
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
                            defaultValue={profile?.visitorOrg ?? ''}
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
                          defaultValue={Math.min(profile?.partySize ?? 1, info.maxParty)}
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
                              defaultValue={
                                profile?.idProofKind &&
                                info.idProofKinds.includes(profile.idProofKind)
                                  ? profile.idProofKind
                                  : ''
                              }
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
                              {t(
                                lang,
                                'Last 4 characters of its number',
                                'उसके नंबर के अंतिम 4 अक्षर',
                              )}
                              {info.ask.idProof === 'required' ? ' *' : ''}
                            </span>
                            <input
                              id="v-id4"
                              name="idProofLast4"
                              className="ep-input"
                              pattern="[A-Za-z0-9]{4}"
                              maxLength={4}
                              required={info.ask.idProof === 'required'}
                              defaultValue={profile?.idProofLast4 ?? ''}
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
                        <VisitorCamera lang={lang} required={info.ask.photo === 'required'} />
                      ) : null}
                      <label className="ep-field" htmlFor="v-email">
                        <span className="ep-field__label">
                          {t(
                            lang,
                            'Email (optional; your pass and visitor card are sent here)',
                            'ईमेल (वैकल्पिक; आपका पास और आगंतुक कार्ड यहाँ भेजा जाता है)',
                          )}
                        </span>
                        <input
                          id="v-email"
                          name="visitorEmail"
                          type="email"
                          className="ep-input"
                          maxLength={200}
                          defaultValue={profile?.visitorEmail ?? ''}
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
                      {info.instructions ? (
                        <p className="ep-field__help">{info.instructions}</p>
                      ) : null}
                      <div>
                        <Button type="submit">
                          {t(lang, 'Request the appointment', 'मुलाक़ात का अनुरोध भेजें')}
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              ) : null}
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
