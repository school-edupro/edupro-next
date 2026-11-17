import { Card, PageHeader } from '@edupro/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { VerifyCheck, type HumanCheck } from '@/components/VerifyCheck';
import { PublicApiError, certFetch, langOf, t } from '@/lib/api';

/** Not in search engines: the page is for people holding a certificate. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The school's certificate check (docs/design/87, phase D): the number as printed and the date of issue; the answer
 * says whether the school's register holds it, and whether it is valid. For people only (17 Nov 2026): the check
 * runs after the human check, and the number and date never go in the address.
 */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { school } = await params;
  const lang = langOf((await searchParams).lang);
  let page: { school: string; check: HumanCheck };
  try {
    page = await certFetch<{ school: string; check: HumanCheck }>(
      `/${encodeURIComponent(school)}/verify`,
    );
  } catch (e) {
    if (e instanceof PublicApiError && e.status === 404) notFound();
    if (e instanceof PublicApiError && e.status === 429)
      return (
        <PageHeader
          kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
          title={t(
            lang,
            'Too many visits: try again in a minute',
            'बहुत अधिक बार: एक मिनट बाद फिर कोशिश करें',
          )}
        />
      );
    throw e;
  }
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <PageHeader
        kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
        title={page.school}
        description={t(
          lang,
          'Scan the QR on the certificate, or enter its number and date of issue as printed.',
          'प्रमाणपत्र का क्यूआर स्कैन करें, या छपा हुआ क्रमांक और जारी करने की तिथि भरें।',
        )}
      />
      <Card>
        <VerifyCheck school={school} lang={lang} check={page.check} nonce={nonce} />
      </Card>
    </>
  );
}
