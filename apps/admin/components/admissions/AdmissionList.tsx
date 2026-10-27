'use client';
import { PeopleList, ddmmyyyy } from '../people/PeopleList';
import type { PeopleListConfig } from '@/lib/people-list';
import type {
  ReportChoice,
  ReportRuntime,
  ReportSpec,
  Result,
  SavedReport,
} from '@/lib/report-builder';
import {
  ADMISSION_QUICK_FILTERS,
  DEFAULT_ADMISSION_VIEW,
  type AdmissionListFields,
  type AdmissionListQuery,
  type AdmissionListResult,
  type AdmissionListView,
} from '@/lib/admission-list';

const TABS: Record<string, string[]> = {
  in_progress: [
    'Registered',
    'Under review',
    'Correction asked',
    'Shortlisted',
    'Selected',
    'Waiting list',
    'Offered',
  ],
  unfinished: ['Form not submitted', 'Registration fee due'],
  admitted: ['Admission fee paid', 'Admitted'],
  closed: ['Not selected', 'Withdrawn', 'Cancelled'],
};
const TONE = (s: string) =>
  ['Admitted', 'Admission fee paid', 'Registered'].includes(s)
    ? 'success'
    : ['Not selected', 'Cancelled', 'Withdrawn'].includes(s)
      ? 'danger'
      : ['Offered', 'Correction asked', 'Registration fee due'].includes(s)
        ? 'warning'
        : 'info';

/** What the admissions list sets for itself on the shared people list (docs/design/39, part 7). */
const ADMISSIONS: PeopleListConfig<AdmissionListView, AdmissionListResult> = {
  noun: { one: 'registration', many: 'registrations', heading: 'Candidate' },
  defaultView: DEFAULT_ADMISSION_VIEW,
  quickFilters: ADMISSION_QUICK_FILTERS,
  statuses: [
    { value: 'in_progress', label: 'In progress' },
    { value: 'unfinished', label: 'Not registered yet' },
    { value: 'admitted', label: 'Fee paid / admitted' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' },
  ],
  defaultStatus: 'in_progress',
  searchLabel: 'Candidate, registration no., admission no., mobile or email',
  searchedAllNote: 'search looks in every registration, whatever its status',
  columnSearchPlaceholder: 'Search: fee, father, previous school…',
  report: { name: 'Admissions list', description: 'Saved from the admissions list' },
  primary: { key: 'candidate', avatar: false },
  newFilterKey: 'class_sought',
  viewToSpec(v): ReportSpec {
    const searching = Boolean(v.search?.trim());
    const status: ReportSpec['filters'] =
      searching || v.status === 'all'
        ? []
        : v.status === 'mine'
          ? // a saved report is not one person's: it keeps those waiting at a level
            [{ key: 'level', op: 'not_empty' }]
          : [{ key: 'status', op: 'in', values: TABS[v.status] ?? [] }];
    const columns = [
      { key: 'registration_no' },
      { key: 'candidate', label: 'Candidate' },
      ...v.columns.filter((c) => c.key !== 'registration_no' && c.key !== 'candidate'),
    ];
    return {
      dataset: 'admissions',
      columns,
      filters: [...status, ...v.filters],
      sort: v.sort.length ? v.sort : [{ key: 'registration_no', dir: 'desc' }],
      options: {
        paper: columns.length > 15 ? 'A3' : 'A4',
        orientation: 'auto',
        includeInactive: true,
        search: v.search || null,
      },
    };
  },
  counts: ({ stats: s }) => [
    ['Total', s.total],
    ['In progress', s.in_progress],
    ['Not registered yet', s.unfinished],
    ['Fee paid / admitted', s.admitted],
    ['Closed', s.closed],
  ],
  rowHref: (id) => `/admissions/registrations/${id}`,
  identity: (r) => (
    <span className="ep-sl__sub">
      {String(r.registration_no ?? 'Not registered')}
      {r.class_sought ? ` · ${String(r.class_sought)}` : ''}
      {r.admission_no ? ` · Adm. ${String(r.admission_no)}` : ''}
    </span>
  ),
  statusCell: (r) => (
    <>
      <span className={`ep-badge ep-badge--${TONE(String(r.status ?? ''))}`}>
        {String(r.status ?? '')}
      </span>
      {r.registered_on ? <span className="ep-sl__sub">{ddmmyyyy(r.registered_on)}</span> : null}
    </>
  ),
  menu: (id) => (
    <>
      <li>
        <a href={`/admissions/registrations/${id}`}>Open</a>
      </li>
      <li>
        <a href={`/admissions/desk/${id}`}>Desk view</a>
      </li>
    </>
  ),
  tools: (can) => (
    <>
      <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/fee-collection">
        Fee collection
      </a>
      {can.desk ? (
        <a className="ep-btn ep-btn--primary ep-btn--sm" href="/admissions/desk">
          Register a walk-in
        </a>
      ) : null}
    </>
  ),
};

export function AdmissionList(props: {
  fields: AdmissionListFields;
  initial: AdmissionListResult;
  initialView: AdmissionListView;
  can: { builder: boolean; desk: boolean };
  actions: {
    load: (q: AdmissionListQuery) => Promise<Result<AdmissionListResult>>;
    saveView: (v: AdmissionListView) => Promise<void>;
    exportFile: (
      q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
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
    runReady?: (
      key: string,
      q: AdmissionListQuery & { format: 'xlsx' | 'pdf' },
    ) => Promise<Result<{ filename: string; contentType: string; base64: string }>>;
  };
  reports?: ReportChoice[];
  /** ready-made admission reports (docs/design/52) */
  ready?: Array<{ key: string; name: string; description: string }>;
}) {
  return <PeopleList config={ADMISSIONS} {...props} />;
}
