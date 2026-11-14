import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CertificateCheckResult } from '@/components/CertificateCheckResult';
import { PublicApiError, certFetch, langOf, t, type CertificateCheck } from '@/lib/api';

/** The page behind a certificate's QR (docs/design/87, phase D): is it valid, and what it is. */
export default async function VerifyTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school, token } = await params;
  const lang = langOf((await searchParams).lang);
  let r: CertificateCheck;
  try {
    r = await certFetch<CertificateCheck>(
      `/${encodeURIComponent(school)}/verify/${encodeURIComponent(token)}`,
    );
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    if (error instanceof PublicApiError && error.status === 429)
      return (
        <PageHeader
          kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
          title={t(
            lang,
            'Too many checks: try again in a minute',
            'बहुत अधिक जाँच: एक मिनट बाद फिर कोशिश करें',
          )}
        />
      );
    throw error;
  }
  return (
    <>
      <PageHeader
        kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
        title={r.school.name}
        description={t(
          lang,
          'What the school’s register says of this certificate.',
          'विद्यालय के रजिस्टर के अनुसार इस प्रमाणपत्र का विवरण।',
        )}
      />
      <CertificateCheckResult r={r} lang={lang} />
      <p className="ep-field__help">
        <a href={`/${school}/verify${lang === 'hi' ? '?lang=hi' : ''}`}>
          {t(
            lang,
            'Check another certificate by its number',
            'क्रमांक से कोई और प्रमाणपत्र जाँचें',
          )}
        </a>
      </p>
    </>
  );
}
