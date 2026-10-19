import { Breadcrumbs, PageHeader, type AcrReportView } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AcrReport } from '@/components/acr/AcrReport';
import { ApiError, apiFetch } from '@/lib/api';

/** One ACR from My ACR: my self-appraisal and result, or the level waiting on me. */
export default async function MyAcrReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const report = await apiFetch<AcrReportView>(`/people/acr/reports/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'My profile', href: '/me/profile' },
          { label: 'My ACR', href: '/me/acr' },
          { label: report.employee.name },
        ]}
      />
      <PageHeader
        kicker="My ACR"
        title={report.employee.name}
        description={`Annual confidential report · ${report.employee.code}`}
        actions={
          <a className="ep-btn ep-btn--ghost" href="/me/acr">
            Back
          </a>
        }
      />
      <AcrReport report={report} />
    </>
  );
}
