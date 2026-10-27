import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionList } from '@/components/admissions/AdmissionList';
import { Notice } from '@/components/Notice';
import { builderExport, builderSave } from '@/lib/actions';
import {
  DEFAULT_REGISTRATIONS_VIEW,
  sanitizeAdmissionView,
  type AdmissionListFields,
  type AdmissionListResult,
  type AdmissionListStatus,
} from '@/lib/admission-list';
import {
  registrationsBulkDecide,
  registrationsExport,
  registrationsReady,
  registrationsLoad,
  registrationsSaveView,
} from '@/lib/admission-list-actions';
import { apiFetch, getMe } from '@/lib/api';
import { reportChoices, type SavedReport } from '@/lib/report-builder';

const TABS = new Set<AdmissionListStatus>([
  'mine',
  'in_progress',
  'unfinished',
  'admitted',
  'closed',
  'all',
]);

/**
 * Registrations (docs/design/47): the admissions grid on submitted registrations with the process —
 * waiting at, level, who decides, waiting since, overdue; Waiting for me first, with bulk decide for
 * those who decide; columns, filters, saved view and Excel / PDF as on the Admissions list.
 */
export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    tab?: string;
    all?: string;
    /** from the dashboard: a session's name and statuses (list labels, | between) */
    session?: string;
    status?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  if (!can('admissions.application.view')) notFound();
  const manager = can('admissions.setup.manage');
  const decides = can('admissions.application.decide') || manager;
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
    apiFetch<{ value: unknown }>('/me/preferences/admissions.registrations').catch(() => ({
      value: null,
    })),
    apiFetch<{ reports: Array<{ key: string; name: string; description: string }> }>(
      '/admissions/registrations/grid/ready-made',
    ).catch(() => ({ reports: [] })),
  ]);
  const kept = sanitizeAdmissionView(
    saved.value,
    new Set(fields.fields.map((f) => f.key)),
    DEFAULT_REGISTRATIONS_VIEW,
  );
  // a link (the morning email, the approvals menu) may open a tab; set-up managers may see every one waiting
  const tab = TABS.has(sp.tab as AdmissionListStatus) ? (sp.tab as AdmissionListStatus) : null;
  const linked = (sp.session ?? sp.status) !== undefined;
  const view = {
    ...kept,
    ...(tab ? { status: tab, search: '' } : {}),
    ...(linked
      ? {
          status: 'all' as const,
          search: '',
          filters: [
            ...kept.filters.filter((x) => x.key !== 'session' && x.key !== 'status'),
            ...(sp.session ? [{ key: 'session', op: 'in' as const, values: [sp.session] }] : []),
            ...(sp.status
              ? [{ key: 'status', op: 'in' as const, values: sp.status.split('|').slice(0, 10) }]
              : []),
          ],
        }
      : {}),
    includeAll: manager && (sp.all === undefined ? Boolean(kept.includeAll) : sp.all === '1'),
  };
  const initial = await apiFetch<AdmissionListResult>('/admissions/registrations/grid', {
    method: 'POST',
    body: JSON.stringify({
      ...view,
      scope: 'registrations',
      search: view.search || undefined,
      page: 1,
    }),
  });
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Registrations"
        description="Submitted registrations with the stage and level each waits at and who decides there. Waiting for me lists those you may decide now; tick several at one stage and level to decide them together."
        actions={
          manager ? (
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/admissions/registrations?tab=mine&all=${view.includeAll ? '0' : '1'}`}
            >
              {view.includeAll
                ? 'Waiting for me: only my levels'
                : 'Waiting for me: every registration waiting'}
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <AdmissionList
        mode="registrations"
        fields={fields}
        initial={initial}
        initialView={view}
        can={{ builder: can('reports.builder.use'), desk: can('admissions.application.enter') }}
        reports={reports}
        ready={ready.reports}
        bulkDecide={decides ? registrationsBulkDecide : undefined}
        actions={{
          load: registrationsLoad,
          exportFile: registrationsExport,
          saveReport: builderSave,
          runReport: builderExport,
          runReady: registrationsReady,
          saveView: registrationsSaveView,
        }}
      />
    </>
  );
}
