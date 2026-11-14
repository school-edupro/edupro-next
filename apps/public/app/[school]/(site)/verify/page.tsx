import { Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CertificateCheckResult } from '@/components/CertificateCheckResult';
import { PublicApiError, certFetch, langOf, t, type CertificateCheck } from '@/lib/api';

/**
 * The school's certificate check (docs/design/87, phase D): the number as printed and the date of issue; the answer
 * says whether the school's register holds it, and whether it is valid.
 */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ lang?: string; number?: string; date?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  const number = (sp.number ?? '').trim().slice(0, 60);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : '';
  let name: string;
  let r: CertificateCheck | null = null;
  let error: string | null = null;
  try {
    if (number && date) {
      r = await certFetch<CertificateCheck>(
        `/${encodeURIComponent(school)}/verify?number=${encodeURIComponent(number)}&date=${date}`,
      );
      name = r.school.name;
    } else
      name = (await certFetch<{ school: string }>(`/${encodeURIComponent(school)}/verify`)).school;
  } catch (e) {
    if (e instanceof PublicApiError && e.status === 404) notFound();
    if (e instanceof PublicApiError && (e.status === 429 || e.status === 400)) {
      error =
        e.status === 429
          ? t(
              lang,
              'Too many checks: try again in a minute.',
              'बहुत अधिक जाँच: एक मिनट बाद फिर कोशिश करें।',
            )
          : (e.problem.detail ?? e.problem.type);
      name = '';
    } else throw e;
  }
  return (
    <>
      <PageHeader
        kicker={t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
        title={name || t(lang, 'Certificate check', 'प्रमाणपत्र जाँच')}
        description={t(
          lang,
          'Scan the QR on the certificate, or enter its number and date of issue as printed.',
          'प्रमाणपत्र का क्यूआर स्कैन करें, या छपा हुआ क्रमांक और जारी करने की तिथि भरें।',
        )}
      />
      <Card>
        <form method="get" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          {lang === 'hi' ? <input type="hidden" name="lang" value="hi" /> : null}
          <label className="ep-field" htmlFor="number">
            <span className="ep-field__label">
              {t(lang, 'Certificate number', 'प्रमाणपत्र क्रमांक')}
            </span>
            <input
              id="number"
              name="number"
              className="ep-input"
              defaultValue={number}
              required
              minLength={3}
              maxLength={60}
              placeholder="TC/2026-27/00012"
            />
          </label>
          <label className="ep-field" htmlFor="date">
            <span className="ep-field__label">{t(lang, 'Date of issue', 'जारी करने की तिथि')}</span>
            <input
              id="date"
              name="date"
              type="date"
              className="ep-input"
              defaultValue={date}
              required
            />
          </label>
          <div>
            <Button type="submit">{t(lang, 'Check', 'जाँचें')}</Button>
          </div>
        </form>
      </Card>
      {error ? (
        <div className="ep-alert ep-alert--warning" role="alert">
          {error}
        </div>
      ) : null}
      {r ? <CertificateCheckResult r={r} lang={lang} /> : null}
    </>
  );
}
