import { Badge, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { COOKIE, PublicApiError, langOf, publicFetch, t, type Cycle } from '@/lib/api';

/** Open cycles of one school with classes, age windows and the application fee (S8-05). */
export default async function SchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school } = await params;
  const lang = langOf((await searchParams).lang);
  const cycles = await publicFetch<{ data: Cycle[] }>(`/${school}/cycles`, {}, null)
    .then((r) => r.data)
    .catch((error: unknown) => {
      // an address that is not a school (a mistyped code, /favicon.ico) is a plain "not found"
      if (error instanceof PublicApiError && error.status === 404) notFound();
      throw error;
    });
  const signedIn = Boolean((await cookies()).get(COOKIE)?.value);
  return (
    <>
      <PageHeader
        kicker={school.toUpperCase()}
        title={t(lang, 'Admissions', 'प्रवेश')}
        description={t(
          lang,
          'Apply online. You will sign in with a one-time code sent to your mobile.',
          'ऑनलाइन आवेदन करें। आप अपने मोबाइल पर भेजे गए एक बार के कोड से साइन इन करेंगे।',
        )}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/${school}/appointment?lang=${lang}`}
            >
              {t(lang, 'Book an appointment', 'मुलाक़ात का समय लें')}
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/${school}/status?lang=${lang}`}
            >
              {signedIn
                ? t(lang, 'My applications', 'मेरे आवेदन')
                : t(lang, 'Check status', 'स्थिति देखें')}
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/${school}?lang=${lang === 'hi' ? 'en' : 'hi'}`}
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </a>
          </span>
        }
      />
      {cycles.length === 0 ? (
        <Card>
          {t(
            lang,
            'No admission cycle is open at the moment.',
            'इस समय कोई प्रवेश चक्र खुला नहीं है।',
          )}
        </Card>
      ) : null}
      {cycles.map((c) => (
        <Card
          key={c.id}
          elevated
          title={lang === 'hi' && c.nameHi ? c.nameHi : c.name}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <div className="ep-kicker">
            {t(lang, 'Session', 'सत्र')} {c.academicYear} · {t(lang, 'closes', 'अंतिम तिथि')}{' '}
            {new Date(c.closesAt).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
            {Number(c.applicationFee) > 0
              ? ` · ${t(lang, 'fee', 'शुल्क')} ₹${c.applicationFee}`
              : ''}
          </div>
          {(lang === 'hi' && c.instructionsHi) || c.instructions ? (
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--sp-2)' }}>
              {lang === 'hi' && c.instructionsHi ? c.instructionsHi : c.instructions}
            </p>
          ) : null}
          <table style={{ width: '100%', marginTop: 'var(--sp-3)', fontSize: 'var(--fs-small)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th>{t(lang, 'Class', 'कक्षा')}</th>
                <th>{t(lang, 'Seats', 'सीटें')}</th>
                <th>{t(lang, 'Date of birth between', 'जन्म तिथि के बीच')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {c.criteria.map((k) => (
                <tr key={k.classId} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: 'var(--sp-2) 0' }}>
                    <strong>{k.classCode}</strong> · {k.className}
                  </td>
                  <td>{k.seats}</td>
                  <td>
                    {k.dobFrom ?? '…'} → {k.dobTo ?? '…'}
                    {k.passcode ? (
                      <>
                        {' '}
                        <Badge tone="warning">{t(lang, 'passcode', 'पासकोड')}</Badge>
                      </>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <a
                      className="ep-btn ep-btn--sm"
                      href={`/${school}/apply/${c.id}?class=${k.classId}&lang=${lang}`}
                    >
                      {t(lang, 'Apply', 'आवेदन करें')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  );
}
