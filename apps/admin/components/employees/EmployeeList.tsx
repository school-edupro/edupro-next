'use client';
import { PeopleList } from '../people/PeopleList';
import type { PeopleListConfig } from '@/lib/people-list';
import type {
  ReportChoice,
  ReportRuntime,
  ReportSpec,
  Result,
  SavedReport,
} from '@/lib/report-builder';
import {
  DEFAULT_EMPLOYEE_VIEW,
  EMPLOYEE_QUICK_FILTERS,
  type EmployeeListFields,
  type EmployeeListQuery,
  type EmployeeListResult,
  type EmployeeListView,
} from '@/lib/employee-list';

/** What the employee list sets for itself on the shared people list (docs/design/30-employee-master.md). */
const EMPLOYEES: PeopleListConfig<EmployeeListView, EmployeeListResult> = {
  noun: { one: 'employee', many: 'employees', heading: 'Employee' },
  defaultView: DEFAULT_EMPLOYEE_VIEW,
  quickFilters: EMPLOYEE_QUICK_FILTERS,
  statuses: [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Left / inactive' },
    { value: 'all', label: 'All' },
  ],
  defaultStatus: 'active',
  searchLabel: 'Name, code, mobile or email',
  searchedAllNote: 'search looks in all employees, active or not',
  columnSearchPlaceholder: 'Search: mobile, PAN, qualification…',
  report: { name: 'Employee list', description: 'Saved from the employee list' },
  viewToSpec(v): ReportSpec {
    // a search looks in every employee, whatever the status
    const searching = Boolean(v.search?.trim());
    const status: ReportSpec['filters'] =
      searching || v.status === 'all'
        ? []
        : [
            {
              key: 'employee_status',
              op: v.status === 'active' ? 'eq' : 'neq',
              values: ['Active'],
            },
          ];
    const columns = [
      { key: 'employee_code' },
      { key: 'full_name', label: 'Employee' },
      ...v.columns.filter((c) => c.key !== 'employee_code' && c.key !== 'full_name'),
    ];
    return {
      dataset: 'employee_profile',
      columns,
      filters: [...status, ...v.filters],
      sort: v.sort.length ? v.sort : [{ key: 'full_name', dir: 'asc' }],
      options: {
        paper: columns.length > 15 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: searching || v.status !== 'active',
        search: v.search || null,
      },
    };
  },
  counts: ({ stats: s }) => [
    ['Total', s.total],
    ['Active', s.active],
    ['Left / inactive', s.inactive],
    ['Teaching', s.teaching],
    ['Non-teaching', s.nonTeaching],
    ['No login', s.noLogin],
    ['Profile incomplete', s.incomplete],
  ],
  rowHref: (id) => `/people/employees/${id}`,
  identity: (r) => (
    <span className="ep-sl__sub">
      {String(r.employee_code ?? '')}
      {r.designation ? ` · ${String(r.designation)}` : ''}
    </span>
  ),
  statusCell: (r) => {
    const active = r.employee_status === 'Active';
    const done = Number(r.profile_completeness ?? 0);
    return (
      <>
        <span className={`ep-badge ep-badge--${active ? 'success' : 'warning'}`}>
          {active ? 'Active' : 'Inactive'}
        </span>
        {done < 100 ? <span className="ep-sl__sub">Profile {done}%</span> : null}
      </>
    );
  },
  menu: (id, _r, can) => (
    <>
      <li>
        <a href={`/people/employees/${id}`}>Open</a>
      </li>
      {can.edit ? (
        <li>
          <a href={`/people/employees/${id}?tab=profile`}>Edit full profile</a>
        </li>
      ) : null}
      <li>
        <a href={`/people/employees/${id}?tab=education`}>Education</a>
      </li>
      <li>
        <a href={`/people/employees/${id}?tab=history`}>Transfers and remarks</a>
      </li>
      <li>
        <a href={`/people/employees/${id}?tab=posting`}>Posting and documents</a>
      </li>
      {can.portal ? (
        <li>
          <a href={`/people/employees/${id}?openAs=1`}>Open an app as them…</a>
        </li>
      ) : null}
    </>
  ),
  tools: (can) => (
    <>
      {can.importRun ? (
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/employees/bulk">
          Excel upload
        </a>
      ) : null}
      {can.setup ? (
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/masters/staff">
          Staff setup
        </a>
      ) : null}
      {can.create ? (
        <a className="ep-btn ep-btn--primary ep-btn--sm" href="/people/employees/new">
          Onboard
        </a>
      ) : null}
    </>
  ),
};

/** The employee list: the shared people list with the staff statuses, counts and links. */
export function EmployeeList(props: {
  fields: EmployeeListFields;
  initial: EmployeeListResult;
  initialView: EmployeeListView;
  can: {
    create: boolean;
    importRun: boolean;
    builder: boolean;
    edit: boolean;
    setup: boolean;
    /** may open the teacher app or the admin app as an employee (access.portal.view_as, 0188) */
    portal: boolean;
  };
  actions: {
    load: (q: EmployeeListQuery) => Promise<Result<EmployeeListResult>>;
    saveView: (v: EmployeeListView) => Promise<void>;
    exportFile: (
      q: EmployeeListQuery & { format: 'xlsx' | 'pdf' },
    ) => Promise<Result<{ exportId: string; format: string; spec: ReportSpec }>>;
    saveReport: (
      id: null,
      input: { name: string; description: string | null; spec: ReportSpec },
    ) => Promise<Result<SavedReport>>;
    runReport?: (
      id: string,
      format: 'xlsx' | 'pdf',
      runtime: ReportRuntime,
    ) => Promise<Result<{ exportId: string; format: string }>>;
  };
  reports?: ReportChoice[];
}) {
  return <PeopleList config={EMPLOYEES} {...props} />;
}
