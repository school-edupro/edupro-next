'use client';
import { Dialog, Drawer } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ExportWatcher } from './ExportWatcher';
import { FilterRow } from './ReportBuilder';
import type { ReportSpec, Result, SavedReport } from '@/lib/report-builder';
import {
  DEFAULT_VIEW,
  QUICK_FILTERS,
  type ListStatus,
  type StudentListFields,
  type StudentListQuery,
  type StudentListResult,
  type StudentListView,
} from '@/lib/student-list';

const OLD_DEVICE_KEY = 'edupro.students.view.v1';
const SIZES = [25, 50, 100, 200];

const ddmmyyyy = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]!}-${m[2]!}-${m[1]!}` : String(v);
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const LEFT = ['Withdrawn', 'Left', 'Transferred'];
/** The list view as a report definition (same rules the export uses). */
function viewToSpec(v: StudentListView): ReportSpec {
  const status: ReportSpec['filters'] =
    v.status === 'active'
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
      includeInactive: v.status !== 'active',
      search: v.search || null,
    },
  };
}

/** A filter that can run: it has the values its condition needs. */
function complete(f: StudentListView['filters'][number]): boolean {
  const n = (f.values ?? []).filter((x) => x.trim() !== '').length;
  if (f.op === 'empty' || f.op === 'not_empty') return true;
  return f.op === 'between' ? n >= 2 : n >= 1;
}

/**
 * The students list: counts by status, search and quick filters, any field as a filter, the columns
 * each user wants (chosen, ordered and renamed, saved for the signed-in user only), sortable headers, pages,
 * and the same view as a branded Excel or PDF, or saved as a report.
 */
export function StudentList({
  fields,
  initial,
  initialView,
  can,
  actions,
}: {
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
  };
}) {
  const router = useRouter();
  const byKey = useMemo(() => new Map(fields.fields.map((f) => [f.key, f])), [fields]);
  const byLabel = useMemo(
    () => new Map(fields.fields.map((f) => [f.label.toLowerCase(), f])),
    [fields],
  );
  const [view, setView] = useState<StudentListView>(initialView);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StudentListResult>(initial);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialView.search ?? '');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState<{ id: string; format: string } | null>(null);
  const [pending, start] = useTransition();
  const ready = useRef(true);
  const fieldListId = 'sl-fields';

  const load = useCallback(
    (v: StudentListView, p: number) =>
      start(async () => {
        const r = await actions.load({ ...v, page: p });
        if (r.ok) {
          setData(r.data);
          setPage(r.data.page);
          setError(null);
        } else setError(r.errors?.join('; ') ?? r.error);
      }),
    [actions],
  );

  // views used to live in this browser; they are per user on the server now, so drop the old copy
  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_DEVICE_KEY);
    } catch {
      // storage blocked: nothing to remove
    }
  }, []);

  const apply = (next: StudentListView, p = 1) => {
    setView(next);
    load(next, p);
    // saved for the signed-in user of this school only; a failed save never blocks the list
    void actions.saveView(next).catch(() => undefined);
  };

  // search as you type (after a short pause)
  useEffect(() => {
    if (!ready.current || search === (view.search ?? '')) return;
    const t = setTimeout(() => apply({ ...view, search }), 350);
    return () => clearTimeout(t);
  }, [search]);

  const quickValue = (key: string) =>
    view.filters.find((f) => f.key === key && (f.op === 'eq' || f.op === 'in'))?.values?.[0] ?? '';
  const setQuick = (key: string, value: string) => {
    const others = view.filters.filter((f) => !(f.key === key && (f.op === 'eq' || f.op === 'in')));
    apply({
      ...view,
      filters: value ? [...others, { key, op: 'eq', values: [value] }] : others,
    });
  };
  const isQuick = (f: StudentListView['filters'][number]) =>
    QUICK_FILTERS.includes(f.key) && (f.op === 'eq' || f.op === 'in');
  const moreFilters = view.filters.filter((f) => !isQuick(f));
  const activeFilterCount = view.filters.length + (view.search ? 1 : 0);

  const sortBy = (key: string) => {
    const cur = view.sort[0];
    const dir: 'asc' | 'desc' = cur?.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
    apply({ ...view, sort: [{ key, dir }] }, 1);
  };
  const sortMark = (key: string) =>
    view.sort[0]?.key === key ? (view.sort[0].dir === 'asc' ? ' ▲' : ' ▼') : '';
  const ariaSort = (key: string): 'ascending' | 'descending' | 'none' =>
    view.sort[0]?.key === key ? (view.sort[0].dir === 'asc' ? 'ascending' : 'descending') : 'none';

  const doExport = (format: 'xlsx' | 'pdf') =>
    start(async () => {
      const r = await actions.exportFile({ ...view, page: 1, format });
      if (r.ok) setExporting({ id: r.data.exportId, format });
      else setError(r.errors?.join('; ') ?? r.error);
    });

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('Student list');
  const saveAsReport = () =>
    start(async () => {
      if (saveName.trim().length < 3)
        return setError('Give the report a name of at least 3 characters.');
      const r = await actions.saveReport(null, {
        name: saveName.trim(),
        description: 'Saved from the students list',
        spec: viewToSpec(view),
      });
      if (r.ok) router.push(`/reports/builder/${r.data.id}?ok=1`);
      else {
        setSaveOpen(false);
        setError(r.errors?.join('; ') ?? r.error);
      }
    });

  const s = data.stats;
  const cards: Array<[ListStatus, string, number, string]> = [
    ['all', 'Total students', s.total, 'info'],
    ['active', 'Active', s.active, 'success'],
    ['inactive', 'Inactive', s.inactive, 'warning'],
    ['withdrawn', 'Withdrawn / left', s.withdrawn, 'danger'],
  ];
  const from = data.total ? (page - 1) * view.size + 1 : 0;
  const to = Math.min(page * view.size, data.total);

  return (
    <div className="ep-sl" aria-busy={pending}>
      <div className="ep-sl__stats" role="group" aria-label="Students by status">
        {cards.map(([st, label, n, tone]) => (
          <button
            key={st}
            type="button"
            className={`ep-sl__stat ep-sl__stat--${tone}`}
            aria-pressed={view.status === st}
            onClick={() => apply({ ...view, status: st })}
          >
            <span className="ep-sl__stat-n">{n.toLocaleString('en-IN')}</span>
            <span className="ep-sl__stat-l">{label}</span>
          </button>
        ))}
      </div>

      <section className="ep-card ep-sl__filters" aria-label="Search and filters">
        <div className="ep-sl__filter-grid">
          <label className="ep-field ep-sl__search" htmlFor="sl-search">
            <span className="ep-field__label">Search</span>
            <input
              id="sl-search"
              className="ep-input"
              type="search"
              value={search}
              placeholder="Admission no, name or parent's mobile"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {QUICK_FILTERS.map((key) => {
            const f = byKey.get(key);
            if (!f) return null;
            return (
              <label key={key} className="ep-field" htmlFor={`sl-q-${key}`}>
                <span className="ep-field__label">{f.label}</span>
                <select
                  id={`sl-q-${key}`}
                  className="ep-input"
                  value={quickValue(key)}
                  onChange={(e) => setQuick(key, e.target.value)}
                >
                  <option value="">All</option>
                  {/* a value from a saved view that is no longer in the list stays visible */}
                  {quickValue(key) && !(f.options ?? []).includes(quickValue(key)) ? (
                    <option value={quickValue(key)}>{quickValue(key)}</option>
                  ) : null}
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <div className="ep-sl__filter-actions">
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setFiltersOpen(true)}
          >
            More filters{moreFilters.length ? ` (${String(moreFilters.length)})` : ''}
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setColumnsOpen(true)}
          >
            Columns ({view.columns.length})
          </button>
          {activeFilterCount ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => {
                setSearch('');
                apply({ ...view, filters: [], search: '' });
              }}
            >
              Clear filters
            </button>
          ) : null}
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              setSearch('');
              apply(DEFAULT_VIEW);
            }}
          >
            Reset view
          </button>
        </div>
      </section>

      <div className="ep-sl__toolbar">
        <span className="ep-sl__count" aria-live="polite">
          {pending
            ? 'Loading…'
            : `Showing ${String(from)}–${String(to)} of ${data.total.toLocaleString('en-IN')}`}
        </span>
        <div className="ep-sl__tools">
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => doExport('xlsx')}
            disabled={pending}
          >
            Export Excel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => doExport('pdf')}
            disabled={pending || view.columns.length + 2 > 25}
            title={
              view.columns.length + 2 > 25
                ? 'Too many columns for a PDF page; use Excel'
                : undefined
            }
          >
            Export PDF
          </button>
          {can.builder ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setSaveOpen(true)}
              disabled={pending}
            >
              Save as report
            </button>
          ) : null}
          {can.builder ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/reports/builder">
              Report builder
            </a>
          ) : null}
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
        </div>
      </div>
      {error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {error}
        </div>
      ) : null}
      {exporting ? (
        <ExportWatcher
          id={exporting.id}
          format={exporting.format}
          labels={{
            queued: 'Student list requested',
            ready: 'Download',
            pending: 'Preparing the file… it downloads automatically',
            failed: 'The file could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}

      <div
        className="ep-table-wrap ep-sl__table"
        tabIndex={0}
        role="region"
        aria-label="Students (scrolls sideways)"
      >
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col" className="ep-sl__sticky" aria-sort={ariaSort('full_name')}>
                <button type="button" className="ep-sl__sort" onClick={() => sortBy('full_name')}>
                  Student{sortMark('full_name')}
                </button>
              </th>
              {data.columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c.key)}>
                  <button type="button" className="ep-sl__sort" onClick={() => sortBy(c.key)}>
                    {c.header}
                    {sortMark(c.key)}
                  </button>
                </th>
              ))}
              <th scope="col">Status</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const id = String(r.__id);
              const name = String(r.full_name ?? '');
              const left = ['Withdrawn', 'Left', 'Transferred'].includes(
                String(r.enrolment_status),
              );
              return (
                <tr key={id}>
                  <td className="ep-sl__sticky">
                    <a href={`/people/students/${id}`} className="ep-sl__who">
                      {r.__photo ? (
                        // photos pass through the admin's own origin
                        <img
                          src={`/api/files/${String(r.__photo)}/view`}
                          alt=""
                          className="ep-sl__avatar"
                        />
                      ) : (
                        <span className="ep-sl__avatar" aria-hidden="true">
                          {initials(name)}
                        </span>
                      )}
                      <span>
                        <strong>{name}</strong>
                        <span className="ep-sl__sub">
                          {String(r.admission_no ?? '')}
                          {r.dob ? ` · ${ddmmyyyy(r.dob)}` : ''}
                          {r.gender ? ` · ${String(r.gender).charAt(0)}` : ''}
                        </span>
                      </span>
                    </a>
                  </td>
                  {data.columns.map((c) => (
                    <td key={c.key} className={c.type === 'number' ? 'ep-num' : undefined}>
                      {c.type === 'date'
                        ? ddmmyyyy(r[c.key])
                        : r[c.key] === null || r[c.key] === undefined
                          ? ''
                          : String(r[c.key])}
                    </td>
                  ))}
                  <td>
                    <span
                      className={`ep-badge ep-badge--${left ? 'danger' : r.student_status === 'Active' ? 'success' : 'warning'}`}
                    >
                      {left ? String(r.enrolment_status) : String(r.student_status ?? '')}
                    </span>
                  </td>
                  <td>
                    <details className="ep-sl__menu">
                      <summary
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Actions for ${name}`}
                      >
                        Actions ▾
                      </summary>
                      <ul>
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
                      </ul>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && !pending ? (
          <p className="ep-field__help" style={{ padding: 'var(--sp-4)' }}>
            No students match.
          </p>
        ) : null}
      </div>

      <nav className="ep-sl__pager" aria-label="Pages">
        <label className="ep-field ep-sl__size" htmlFor="sl-size">
          <span className="ep-field__label">Records per page</span>
          <select
            id="sl-size"
            className="ep-input"
            value={view.size}
            onChange={(e) => apply({ ...view, size: Number(e.target.value) })}
          >
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="ep-sl__pages">
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page <= 1 || pending}
            onClick={() => load(view, 1)}
          >
            « First
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page <= 1 || pending}
            onClick={() => load(view, page - 1)}
          >
            ‹ Previous
          </button>
          <span>
            Page {page} of {data.pages}
          </span>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page >= data.pages || pending}
            onClick={() => load(view, page + 1)}
          >
            Next ›
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={page >= data.pages || pending}
            onClick={() => load(view, data.pages)}
          >
            Last »
          </button>
        </div>
      </nav>

      <datalist id={fieldListId}>
        {fields.fields.map((f) => (
          <option key={f.key} value={f.label} />
        ))}
      </datalist>

      {saveOpen ? (
        <Dialog
          open
          size="sm"
          title="Save this view as a report"
          onClose={() => setSaveOpen(false)}
          primary={{ label: 'Save report', loading: pending, onClick: saveAsReport }}
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The columns, filters, search and status become a saved report you can share and download
            on the school letterhead.
          </p>
          <label className="ep-field" htmlFor="sl-save-name">
            <span className="ep-field__label">Report name</span>
            <input
              id="sl-save-name"
              className="ep-input"
              value={saveName}
              maxLength={120}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </label>
        </Dialog>
      ) : null}
      {filtersOpen ? (
        <FiltersDialog
          initial={moreFilters}
          byKey={byKey}
          resolve={(l) => byLabel.get(l.trim().toLowerCase())}
          fieldListId={fieldListId}
          onClose={() => setFiltersOpen(false)}
          onApply={(more) => {
            setFiltersOpen(false);
            // unfinished rows (no value where one is needed) are dropped rather than failing the list
            apply({
              ...view,
              filters: [...view.filters.filter(isQuick), ...more.filter(complete)],
            });
          }}
        />
      ) : null}
      {columnsOpen ? (
        <ColumnsDialog
          fields={fields}
          view={view}
          onClose={() => setColumnsOpen(false)}
          onApply={(columns) => {
            setColumnsOpen(false);
            apply({ ...view, columns });
          }}
        />
      ) : null}
    </div>
  );
}

function FiltersDialog({
  initial,
  byKey,
  resolve,
  fieldListId,
  onClose,
  onApply,
}: {
  initial: StudentListView['filters'];
  byKey: Map<string, StudentListFields['fields'][number]>;
  resolve: (label: string) => StudentListFields['fields'][number] | undefined;
  fieldListId: string;
  onClose: () => void;
  onApply: (filters: StudentListView['filters']) => void;
}) {
  const [filters, setFilters] = useState(initial);
  return (
    <Drawer
      open
      width="lg"
      title="More filters"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setFilters([])}>
            Remove all
          </button>
          <button type="button" className="ep-btn ep-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ep-btn ep-btn--primary" onClick={() => onApply(filters)}>
            Apply filters
          </button>
        </>
      }
    >
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Add conditions on any field of the profile, fees or transport. They work together with the
        quick filters above the list; all must match. A condition without a value is ignored.
      </p>
      {filters.map((f, i) => (
        <FilterRow
          key={`${String(i)}-${f.key}`}
          index={i}
          filter={f}
          field={byKey.get(f.key)}
          fieldListId={fieldListId}
          disabled={false}
          resolve={resolve}
          onChange={(next) => setFilters((p) => p.map((x, j) => (j === i ? next : x)))}
          onRemove={() => setFilters((p) => p.filter((_, j) => j !== i))}
        />
      ))}
      {!filters.length ? <p className="ep-field__help">No extra conditions yet.</p> : null}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        onClick={() => setFilters((p) => [...p, { key: 'religion', op: 'in', values: [] }])}
      >
        + Add a condition
      </button>
    </Drawer>
  );
}

function ColumnsDialog({
  fields,
  view,
  onClose,
  onApply,
}: {
  fields: StudentListFields;
  view: StudentListView;
  onClose: () => void;
  onApply: (columns: StudentListView['columns']) => void;
}) {
  const [cols, setCols] = useState(view.columns);
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  const byKey = new Map(fields.fields.map((f) => [f.key, f]));
  const chosen = new Set(cols.map((c) => c.key));
  const toggle = (key: string) =>
    setCols((p) =>
      p.some((c) => c.key === key) ? p.filter((c) => c.key !== key) : [...p, { key }],
    );
  const move = (from: number, to: number) =>
    setCols((p) => {
      if (to < 0 || to >= p.length || from === to) return p;
      const n = [...p];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x!);
      return n;
    });
  const needle = q.trim().toLowerCase();
  return (
    <Drawer
      open
      width="lg"
      title="Columns"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            onClick={() => setCols(DEFAULT_VIEW.columns)}
          >
            Default columns
          </button>
          <button type="button" className="ep-btn ep-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ep-btn ep-btn--primary" onClick={() => onApply(cols)}>
            Show {cols.length} column{cols.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="ep-sl__cols">
        <section aria-label="Available fields" className="ep-sl__colpane">
          <label className="ep-field" htmlFor="sl-col-search">
            <span className="ep-field__label">Add fields</span>
            <input
              id="sl-col-search"
              className="ep-input"
              type="search"
              value={q}
              placeholder="Search: mobile, religion, route…"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="ep-sl__colpick">
            {fields.sections.map((s) => {
              const list = fields.fields.filter(
                (f) =>
                  f.section === s.id &&
                  f.key !== 'full_name' &&
                  (!needle || f.label.toLowerCase().includes(needle)),
              );
              if (!list.length) return null;
              const n = list.filter((f) => chosen.has(f.key)).length;
              return (
                <details key={s.id} open={Boolean(needle)} className="ep-sl__group">
                  <summary>
                    <span>{s.title}</span>
                    {n ? <span className="ep-badge ep-badge--info">{n}</span> : null}
                  </summary>
                  <ul>
                    {list.map((f) => (
                      <li key={f.key}>
                        <label>
                          <input
                            type="checkbox"
                            checked={chosen.has(f.key)}
                            onChange={() => toggle(f.key)}
                          />
                          <span>{f.label}</span>
                          {f.masked ? <span className="ep-sl__masked">masked</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
        <section aria-label="Columns shown" className="ep-sl__colpane">
          <p className="ep-field__label" style={{ margin: 0 }}>
            Shown, in order
          </p>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Drag or use the arrows. Type a header to rename a column. Student and Status always
            show.
          </p>
          <ol className="ep-sl__chosen">
            {cols.map((c, i) => {
              const f = byKey.get(c.key);
              const label = f?.label ?? c.key;
              return (
                <li
                  key={c.key}
                  className="ep-sl__colrow"
                  draggable
                  onDragStart={() => setDrag(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (drag !== null) move(drag, i);
                    setDrag(null);
                  }}
                >
                  <span className="ep-sl__grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <input
                    className="ep-input"
                    value={c.label ?? ''}
                    placeholder={label}
                    maxLength={80}
                    aria-label={`Header for ${label}`}
                    title={label}
                    onChange={(e) =>
                      setCols((p) =>
                        p.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="ep-sl__icon"
                    aria-label={`Move ${label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ep-sl__icon"
                    aria-label={`Move ${label} down`}
                    disabled={i === cols.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ep-sl__icon"
                    aria-label={`Remove ${label}`}
                    onClick={() => toggle(c.key)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
          {!cols.length ? (
            <p className="ep-field__help">Tick fields on the left to add columns.</p>
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}
