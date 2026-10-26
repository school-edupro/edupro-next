'use client';
import { useState, useTransition } from 'react';
import { PeopleList, ddmmyyyy } from '../people/PeopleList';
import type { PeopleRow } from '@/lib/people-list';
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
  DEFAULT_REGISTRATIONS_VIEW,
  REGISTRATION_QUICK_FILTERS,
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

type BulkDecide = (input: {
  ids: string[];
  decision: 'approve' | 'reject' | 'hold';
  remarks?: string;
}) => Promise<
  Result<{ done: number; failed: Array<{ id: string; number: string | null; reason: string }> }>
>;

/** One decision for the ticked registrations, which must wait at the same stage and level. */
function BulkDecideBar({
  rows,
  done,
  decide,
}: {
  rows: PeopleRow[];
  done: () => void;
  decide: BulkDecide;
}) {
  const [decision, setDecision] = useState<'approve' | 'reject' | 'hold'>('approve');
  const [remarks, setRemarks] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const places = new Set(rows.map((r) => `${String(r.stage ?? '')} · ${String(r.level ?? '')}`));
  const mixed = places.size > 1;
  const at = String(rows[0]?.stage ?? '');
  const level = rows[0]?.level ? ` (level ${String(rows[0].level)})` : '';
  const go = () =>
    start(async () => {
      const r = await decide({ ids: rows.map((x) => String(x.__id)), decision, remarks });
      if (!r.ok) return setMsg({ tone: 'danger', text: r.errors?.join('; ') ?? r.error });
      const f = r.data.failed;
      setMsg({
        tone: f.length ? 'warning' : 'success',
        text: `${String(r.data.done)} decided.${
          f.length
            ? ` Not decided: ${f.map((x) => `${x.number ?? x.id} (${x.reason})`).join('; ')}`
            : ''
        }`,
      });
      setRemarks('');
      done();
    });
  return (
    <section className="ep-card" aria-label="Decide the ticked registrations">
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <strong>{rows.length} ticked</strong>
        {mixed ? null : ` · waiting at ${at}${level}`}
      </p>
      {mixed ? (
        <p className="ep-alert ep-alert--warning" role="alert" style={{ margin: 0 }}>
          The ticked registrations wait at different stages or levels ({[...places].join(', ')}).
          Tick those at one stage and level to decide them together.
        </p>
      ) : (
        <div
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Decision</span>
            <select
              className="ep-select"
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
            >
              <option value="approve">Approve</option>
              <option value="hold">Hold</option>
              <option value="reject">Reject (not selected)</option>
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0, flex: '1 1 260px' }}>
            <span className="ep-field__label">Remarks (for every one ticked)</span>
            <input
              className="ep-input"
              value={remarks}
              maxLength={1000}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={`ep-btn ep-btn--sm ${decision === 'reject' ? 'ep-btn--danger' : 'ep-btn--primary'}`}
            disabled={pending}
            onClick={go}
          >
            {pending ? 'Deciding…' : `Decide ${String(rows.length)}`}
          </button>
        </div>
      )}
      <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
        Each is decided as if opened: only at levels you may decide, the family is told as usual,
        and marks, corrections and offers are given one by one on the registration.
      </p>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role="status"
          style={{ margin: 'var(--sp-2) 0 0' }}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}

const REG_TABS: Array<{ value: AdmissionListView['status']; label: string }> = [
  { value: 'mine', label: 'Waiting for me' },
  { value: 'in_progress', label: 'In process' },
  { value: 'unfinished', label: 'Fee due' },
  { value: 'admitted', label: 'Fee paid / admitted' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

/** The registrations list (docs/design/47): the admissions grid with the process and its queue. */
function registrationsConfig(
  decide: BulkDecide | undefined,
): PeopleListConfig<AdmissionListView, AdmissionListResult> {
  return {
    ...ADMISSIONS,
    noun: { one: 'registration', many: 'registrations', heading: 'Candidate' },
    defaultView: DEFAULT_REGISTRATIONS_VIEW,
    quickFilters: REGISTRATION_QUICK_FILTERS,
    statuses: REG_TABS,
    defaultStatus: 'mine',
    searchedAllNote: 'search looks in every registration, whatever its status or level',
    report: { name: 'Registrations', description: 'Saved from the registrations list' },
    viewToSpec: (v) => {
      const spec = ADMISSIONS.viewToSpec(v);
      return {
        ...spec,
        filters: [...spec.filters, { key: 'status', op: 'not_in', values: ['Form not submitted'] }],
      };
    },
    statusTabs: ({ stats: s }) => [
      { value: 'mine', label: 'Waiting for me', count: s.mine, alert: s.overdue > 0 },
      { value: 'in_progress', label: 'In process', count: s.in_progress },
      { value: 'unfinished', label: 'Fee due', count: s.unfinished },
      { value: 'admitted', label: 'Fee paid / admitted', count: s.admitted },
      { value: 'closed', label: 'Closed', count: s.closed },
      { value: 'all', label: 'All', count: s.total },
    ],
    counts: ({ stats: s }) => [
      ['Waiting for me', s.mine],
      ['Overdue', s.overdue],
      ['In process', s.in_progress],
      ['Total', s.total],
    ],
    statusCell: (r) => (
      <>
        <span className={`ep-badge ep-badge--${TONE(String(r.status ?? ''))}`}>
          {String(r.status ?? '')}
        </span>
        {r.overdue === 'Yes' ? <span className="ep-badge ep-badge--danger">Overdue</span> : null}
        {r.stage ? (
          <span className="ep-sl__sub">
            {String(r.stage)}
            {r.level ? ` · level ${String(r.level)}` : ''}
          </span>
        ) : null}
      </>
    ),
    tools: (can, view) => (
      <>
        <a
          className="ep-btn ep-btn--ghost ep-btn--sm"
          href={`/admissions/registrations/board${view.status === 'mine' ? '?mine=1' : ''}`}
        >
          Board view
        </a>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/schedule">
          Tests and interviews
        </a>
        <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/selection">
          Selection
        </a>
        {can.desk ? (
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/admissions/desk">
            Register a walk-in
          </a>
        ) : null}
      </>
    ),
    select: decide
      ? {
          can: (r) => r.__mine === 'yes',
          bar: (rows, done) => <BulkDecideBar rows={rows} done={done} decide={decide} />,
        }
      : undefined,
  };
}

/** The admissions list: the shared people list on the Admissions dataset. */
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
  };
  reports?: ReportChoice[];
  /** the registrations list (docs/design/47) and, for those who decide, bulk decide */
  mode?: 'list' | 'registrations';
  bulkDecide?: BulkDecide;
}) {
  const { mode = 'list', bulkDecide, ...rest } = props;
  const config = mode === 'registrations' ? registrationsConfig(bulkDecide) : ADMISSIONS;
  return <PeopleList config={config} {...rest} />;
}
