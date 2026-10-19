import { PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { EmployeeList } from '@/components/employees/EmployeeList';
import { builderExport, builderSave } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { reportChoices, type SavedReport } from '@/lib/report-builder';
import { employeeListExport, employeeListLoad, employeeListSaveView } from '@/lib/employee-actions';
import {
  sanitizeEmployeeView,
  type EmployeeListFields,
  type EmployeeListResult,
} from '@/lib/employee-list';

/**
 * Employees (docs/design/30-employee-master.md, part 2): the list as the students list: search, quick
 * and more filters on any field, the columns each user wants, Excel / PDF, save as a report.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  // saved employee reports this user may run, to download for the list's filters
  const reports = can('reports.builder.use')
    ? reportChoices(
        await apiFetch<{ mine: SavedReport[]; shared: SavedReport[] }>('/reports/builder').catch(
          () => ({ mine: [], shared: [] }),
        ),
        'employee_profile',
      )
    : [];
  const [fields, saved] = await Promise.all([
    apiFetch<EmployeeListFields>('/people/staff/grid/fields'),
    // the view this user saved for this school; other users keep their own
    apiFetch<{ value: unknown }>('/me/preferences/employees.list').catch(() => ({ value: null })),
  ]);
  const view = sanitizeEmployeeView(saved.value, new Set(fields.fields.map((f) => f.key)));
  const initial = await apiFetch<EmployeeListResult>('/people/staff/grid', {
    method: 'POST',
    body: JSON.stringify({ ...view, search: view.search || undefined, page: 1 }),
  });
  return (
    <>
      <PageHeader
        kicker="People"
        title="Employees"
        description="Every staff member. Search, filter on any field, choose the columns you want, and export exactly what you see."
      />
      <Notice params={sp} />
      <EmployeeList
        fields={fields}
        initial={initial}
        initialView={view}
        can={{
          create: can('people.employee.create'),
          importRun: can('people.import.run'),
          builder: can('reports.builder.use'),
          edit: can('people.employee.edit'),
          setup: can('people.employee.view'),
          portal: can('access.portal.view_as'),
        }}
        reports={reports}
        actions={{
          load: employeeListLoad,
          exportFile: employeeListExport,
          saveReport: builderSave,
          runReport: builderExport,
          saveView: employeeListSaveView,
        }}
      />
    </>
  );
}
