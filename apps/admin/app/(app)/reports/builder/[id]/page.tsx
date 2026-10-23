import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ReportBuilder } from '@/components/ReportBuilder';
import {
  builderCopy,
  builderExport,
  builderPreview,
  builderSave,
  builderSaveShares,
  builderShareOptions,
} from '@/lib/actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { BuilderFields, SavedReport } from '@/lib/report-builder';

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; run?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('reports.builder.use')) notFound();
  const report = await apiFetch<SavedReport>(`/reports/builder/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  // the fields of the report's own dataset (students or employees)
  const dataset =
    report.dataset === 'employee_profile' || report.dataset === 'admissions'
      ? report.dataset
      : 'student_profile';
  const fields = await apiFetch<BuilderFields>(`/reports/builder/fields?dataset=${dataset}`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports/builder' },
          { label: 'Report builder', href: '/reports/builder' },
          { label: report.name },
        ]}
      />
      <PageHeader
        kicker="Report builder"
        title={report.name}
        description={
          report.description ??
          `${String(report.spec.columns.length)} columns · ${String(report.spec.filters.length)} filters`
        }
      />
      <Notice params={sp} />
      <ReportBuilder
        key={report.updatedAt}
        fields={fields}
        report={report}
        askFirst={sp.run === '1'}
        initialSpec={{ ...report.spec, dataset }}
        actions={{
          preview: builderPreview,
          save: builderSave,
          copy: builderCopy,
          exportFile: builderExport,
          shareOptions: builderShareOptions,
          saveShares: builderSaveShares,
        }}
      />
    </>
  );
}
