import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionList } from '@/components/admissions/AdmissionList';
import { Notice } from '@/components/Notice';
import { builderExport, builderSave } from '@/lib/actions';
import {
  sanitizeAdmissionView,
  type AdmissionListFields,
  type AdmissionListResult,
} from '@/lib/admission-list';
import {
  admissionListExport,
  admissionListLoad,
  admissionListReady,
  admissionListSaveView,
} from '@/lib/admission-list-actions';
import { apiFetch, getMe } from '@/lib/api';
import { reportChoices, type SavedReport } from '@/lib/report-builder';

/**
 * The admissions list (docs/design/39, part 7): every registration with the columns each user wants from
 * the registration, the fees, the admission and the form's answers; quick and more filters on any field;
 * Excel / PDF of what is seen; save as a report.
 */
export default async function AdmissionListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  if (!can('admissions.application.view')) notFound();
  const reports = can('reports.builder.use')
    ? reportChoices(
        await apiFetch<{ mine: SavedReport[]; shared: SavedReport[] }>('/reports/builder').catch(
          () => ({ mine: [], shared: [] }),
        ),
        'admissions',
      )
    : [];
  const [fields, saved, ready] = await Promise.all([
    apiFetch<AdmissionListFields>('/admissions/registrations/grid/fields'),
    apiFetch<{ value: unknown }>('/me/preferences/admissions.list').catch(() => ({ value: null })),
    apiFetch<{ reports: Array<{ key: string; name: string; description: string }> }>(
      '/admissions/registrations/grid/ready-made',
    ).catch(() => ({ reports: [] })),
  ]);
  const view = sanitizeAdmissionView(saved.value, new Set(fields.fields.map((f) => f.key)));
  const initial = await apiFetch<AdmissionListResult>('/admissions/registrations/grid', {
    method: 'POST',
    body: JSON.stringify({ ...view, search: view.search || undefined, page: 1 }),
  });
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admissions list"
        description="Every registration of every session. Search, filter on any field or form answer, choose the columns you want, and export exactly what you see."
      />
      <Notice params={sp} />
      <AdmissionList
        fields={fields}
        initial={initial}
        initialView={view}
        can={{ builder: can('reports.builder.use'), desk: can('admissions.application.enter') }}
        reports={reports}
        ready={ready.reports}
        actions={{
          load: admissionListLoad,
          exportFile: admissionListExport,
          saveReport: builderSave,
          runReport: builderExport,
          runReady: admissionListReady,
          saveView: admissionListSaveView,
        }}
      />
    </>
  );
}
