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
import {
  EMPTY_ADMISSION_SPEC,
  EMPTY_EMPLOYEE_SPEC,
  EMPTY_SPEC,
  type BuilderFields,
} from '@/lib/report-builder';

export default async function NewReportPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('reports.builder.use')) notFound();
  // whose rows: students, or employees (for those who may see employees)
  const canEmployees = me.permissions.includes('people.employee.view');
  const canAdmissions = me.permissions.includes('admissions.application.view');
  const dataset =
    sp.dataset === 'employee_profile' && canEmployees
      ? 'employee_profile'
      : sp.dataset === 'admissions' && canAdmissions
        ? 'admissions'
        : 'student_profile';
  const fields = await apiFetch<BuilderFields>(`/reports/builder/fields?dataset=${dataset}`);
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
      {canEmployees || canAdmissions ? (
        <nav
          className="ep-tabs-links"
          aria-label="Report on"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <a
            href="/reports/builder/new"
            aria-current={dataset === 'student_profile' ? 'page' : undefined}
          >
            Students
          </a>
          {canEmployees ? (
            <a
              href="/reports/builder/new?dataset=employee_profile"
              aria-current={dataset === 'employee_profile' ? 'page' : undefined}
            >
              Employees
            </a>
          ) : null}
          {canAdmissions ? (
            <a
              href="/reports/builder/new?dataset=admissions"
              aria-current={dataset === 'admissions' ? 'page' : undefined}
            >
              Admissions
            </a>
          ) : null}
        </nav>
      ) : null}
      <ReportBuilder
        key={dataset}
        fields={fields}
        report={null}
        initialSpec={
          dataset === 'employee_profile'
            ? EMPTY_EMPLOYEE_SPEC
            : dataset === 'admissions'
              ? EMPTY_ADMISSION_SPEC
              : { ...EMPTY_SPEC, dataset }
        }
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
