import { Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { OpenCertificate } from '@/components/certificates/OpenCertificate';
import { currentLang, t } from '@/lib/i18n';

/** A certificate PDF being made: this step opens it here as soon as it is ready (16 Nov 2026). */
export default async function OpeningCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ export?: string; kind?: string; save?: string; id?: string }>;
}) {
  const sp = await searchParams;
  if (!sp.export || !/^\d{1,18}$/.test(sp.export)) redirect('/certificates');
  const lang = await currentLang();
  const kind = sp.kind === 'award' ? 'award' : 'register';
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Opening the certificate')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/certificates">
            {t(lang, 'Back to certificates')}
          </a>
        }
      />
      <Card>
        <OpenCertificate
          exportId={sp.export}
          kind={kind}
          save={sp.save === '1'}
          retry="/certificates"
          words={{
            wait: t(lang, 'Making the PDF… it opens here by itself in a few seconds.'),
            stuck: t(
              lang,
              'Still waiting: the school is making the PDF. This page opens it as soon as it is ready.',
            ),
            failed: t(lang, 'The PDF could not be made.'),
            again: t(lang, 'Back to certificates'),
            saved: t(lang, 'The PDF is saved to your downloads.'),
          }}
        />
      </Card>
    </main>
  );
}
