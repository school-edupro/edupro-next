'use client';
import { PeopleList, ddmmyyyy } from './people/PeopleList';
import type { PeopleListConfig, PeopleRow } from '@/lib/people-list';
import type {
  ReportChoice,
  ReportRuntime,
  ReportSpec,
  Result,
  SavedReport,
} from '@/lib/report-builder';
import {
  DEFAULT_VIEW,
  QUICK_FILTERS,
  type StudentListFields,
  type StudentListQuery,
  type StudentListResult,
  type StudentListView,
} from '@/lib/student-list';

const OLD_DEVICE_KEY = 'edupro.students.view.v1';
const LEFT = ['Withdrawn', 'Left', 'Transferred'];
const left = (r: PeopleRow) => LEFT.includes(String(r.enrolment_status));

/** What the students list sets for itself on the shared people list. */
const STUDENTS: PeopleListConfig<StudentListView, StudentListResult> = {
  noun: { one: 'student', many: 'students', heading: 'Student' },
  defaultView: DEFAULT_VIEW,
  quickFilters: QUICK_FILTERS,
  statuses: [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'withdrawn', label: 'Withdrawn / left' },
    { value: 'all', label: 'All' },
  ],
  defaultStatus: 'active',
  searchLabel: 'Student, admission no or mobile',
  searchedAllNote:
    'search looks in all students, active or not; the date of withdrawal (DOW) shows for those who have left',
  columnSearchPlaceholder: 'Search: mobile, religion, route…',
  report: { name: 'Student list', description: 'Saved from the students list' },
  viewToSpec(v): ReportSpec {
    // a search looks in every student, whatever the status
    const searching = Boolean(v.search?.trim());
    const status: ReportSpec['filters'] = searching
      ? []
      : v.status === 'active'
        ? [
            { key: 'student_status', op: 'eq', values: ['Active'] },
            { key: 'enrolment_status', op: 'not_in', values: LEFT },
          ]
        : v.status === 'inactive'
          ? [
              { key: 'student_status', op: 'eq', values: ['Inactive'] },
              { key: 'enrolment_status', op: 'not_in', values: LEFT },
            ]
          : v.status === 'withdrawn'
            ? [{ key: 'enrolment_status', op: 'in', values: LEFT }]
            : [];
    const columns = [
      { key: 'admission_no' },
      { key: 'full_name', label: 'Student' },
      ...v.columns.filter((c) => c.key !== 'admission_no' && c.key !== 'full_name'),
    ];
    return {
      columns,
      filters: [...status, ...v.filters],
      sort: v.sort.length
        ? v.sort
        : [
            { key: 'class_section', dir: 'asc' },
            { key: 'roll_no', dir: 'asc' },
          ],
      options: {
        paper: columns.length > 15 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: searching || v.status !== 'active',
        search: v.search || null,
      },
    };
  },
  counts: ({ stats: s }) => [
    ['Total students', s.total],
    ['Active', s.active],
    ['Inactive', s.inactive],
    ['Withdrawn / left', s.withdrawn],
  ],
  rowHref: (id) => `/people/students/${id}`,
  identity: (r) => (
    <>
      <span className="ep-sl__sub">
        {String(r.admission_no ?? '')}
        {r.dob ? ` · ${ddmmyyyy(r.dob)}` : ''}
        {r.gender ? ` · ${String(r.gender).charAt(0)}` : ''}
      </span>
      {left(r) || r.student_status !== 'Active' ? (
        <span className="ep-sl__sub">
          <span className={`ep-badge ep-badge--${left(r) ? 'danger' : 'warning'}`}>
            {left(r) ? String(r.enrolment_status) : String(r.student_status ?? '')}
          </span>
          {r.__left_on ? ` DOW ${ddmmyyyy(r.__left_on)}` : ''}
        </span>
      ) : null}
    </>
  ),
  statusCell: (r) => (
    <>
      <span
        className={`ep-badge ep-badge--${left(r) ? 'danger' : r.student_status === 'Active' ? 'success' : 'warning'}`}
      >
        {left(r) ? String(r.enrolment_status) : String(r.student_status ?? '')}
      </span>
      {r.__left_on ? <span className="ep-sl__sub">DOW {ddmmyyyy(r.__left_on)}</span> : null}
    </>
  ),
  menu: (id, _r, can) => (
    <>
      <li>
        <a href={`/people/students/${id}`}>Open</a>
      </li>
      <li>
        <a href={`/people/students/${id}/profile`}>
          {can.edit ? 'Edit full profile' : 'Full profile'}
        </a>
      </li>
      <li>
        <a href={`/people/students/${id}?tab=documents`}>Documents</a>
      </li>
      <li>
        <a href={`/people/students/${id}?tab=fees`}>Fees</a>
      </li>
      <li>
        <a href={`/people/students/${id}?tab=status`}>Status and certificates</a>
      </li>
    </>
  ),
  tools: (can) => (
    <>
      {can.importRun ? (
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/students/bulk">
          Bulk update
        </a>
      ) : null}
      {can.create ? (
        <>
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/people/students/new">
            Full admission
          </a>
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/people/students/quick-add">
            Add student
          </a>
        </>
      ) : null}
    </>
  ),
  // views used to live in this browser; they are per user on the server now, so drop the old copy
  onMount: () => {
    try {
      window.localStorage.removeItem(OLD_DEVICE_KEY);
    } catch {
      // storage blocked: nothing to remove
    }
  },
};

/** The students list: the shared people list with the students' statuses, counts and links. */
export function StudentList(props: {
  fields: StudentListFields;
  initial: StudentListResult;
  initialView: StudentListView;
  can: { create: boolean; importRun: boolean; builder: boolean; edit: boolean };
  actions: {
    load: (q: StudentListQuery) => Promise<Result<StudentListResult>>;
    saveView: (v: StudentListView) => Promise<void>;
    exportFile: (
      q: StudentListQuery & { format: 'xlsx' | 'pdf' },
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
  return <PeopleList config={STUDENTS} {...props} />;
}
