import { PageHeader, type AcrReportView } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound } from 'next/navigation';
import { AcrReport } from '@/components/AcrReport';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/** One ACR: my self-appraisal and result, or the level waiting on me. */
export default async function AcrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  const report = await bff.api
    .fetch<AcrReportView>(`/people/acr/reports/${id}`)
    .catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  return (
    <main>
      <PageHeader
        kicker={t(lang, 'My ACR')}
        title={report.employee.name}
        description={t(lang, 'Annual confidential report')}
        actions={
          <a className="ep-btn ep-btn--ghost" href="/acr">
            {t(lang, 'Back')}
          </a>
        }
      />
      <AcrReport report={report} />
    </main>
  );
}
