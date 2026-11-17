import { Card, PageHeader } from '@edupro/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { VerifyCheck, type HumanCheck } from '@/components/VerifyCheck';
import { PublicApiError, certFetch, langOf, t } from '@/lib/api';

/** Not in search engines: the page is for people holding a certificate. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The page behind a certificate's QR (docs/design/87, phase D): is it valid, and what it is. For people only (17 Nov
 * 2026): the answer shows after the human check.
 */
export default async function VerifyTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string; token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school, token } = await params;
  const lang = langOf((await searchParams).lang);
  if (!/^[0-9a-f]{20,64}$/.test(token)) notFound();
  let page: { school: string; check: HumanCheck };
  try {
    page = await certFetch<{ school: string; check: HumanCheck }>(
      `/${encodeURIComponent(school)}/verify/${token}`,
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
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <PageHeader
        kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
        title={page.school}
        description={t(
          lang,
          'What the school’s register says of this certificate.',
          'विद्यालय के रजिस्टर के अनुसार इस प्रमाणपत्र का विवरण।',
        )}
      />
      <Card>
        <VerifyCheck school={school} lang={lang} check={page.check} token={token} nonce={nonce} />
      </Card>
      <p className="ep-field__help">
        <a href={`/${school}/verify${lang === 'hi' ? '?lang=hi' : ''}`}>
          {t(
            lang,
            'Check another certificate by its number',
            'क्रमांक से कोई अन्य प्रमाणपत्र जाँचें',
          )}
        </a>
      </p>
    </>
  );
}
