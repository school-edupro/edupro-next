import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ReportBuilder } from '@/components/ReportBuilder';
import {
  builderCopy,
  builderExport,
  builderPreview,
  builderSave,
  builderSaveShares,
  builderShareOptions,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { EMPTY_SPEC, type BuilderFields } from '@/lib/report-builder';

export default async function NewReportPage() {
  const me = await getMe();
  if (!me.permissions.includes('reports.builder.use')) notFound();
  const fields = await apiFetch<BuilderFields>('/reports/builder/fields');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports/builder' },
          { label: 'Report builder', href: '/reports/builder' },
          { label: 'New report' },
        ]}
      />
      <PageHeader
        kicker="Report builder"
        title="New report"
        description="Tick the fields you need, set the headers and filters, preview, then save."
      />
      <ReportBuilder
        fields={fields}
        report={null}
        initialSpec={EMPTY_SPEC}
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
