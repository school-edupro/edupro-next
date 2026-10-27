'use client';
import { Dialog, Drawer } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { ExportWatcher } from '../ExportWatcher';
import { FilterRow } from '../ReportBuilder';
import { MultiPick } from './MultiPick';
import {
  runtimeOf,
  type ReportChoice,
  type ReportRuntime,
  type ReportSpec,
  type Result,
  type SavedReport,
} from '@/lib/report-builder';
import type {
  PeopleListConfig,
  PeopleListFields,
  PeopleListQuery,
  PeopleListResult,
  PeopleListView,
} from '@/lib/people-list';

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

/** A filter that can run: it has the values its condition needs. */
function complete(f: PeopleListView['filters'][number]): boolean {
  const n = (f.values ?? []).filter((x) => x.trim() !== '').length;
  if (f.op === 'empty' || f.op === 'not_empty') return true;
  return f.op === 'between' ? n >= 2 : n >= 1;
}

/** The date as the office writes it, and a name's initials (for the lists' own cells). */
export { ddmmyyyy, initials };

/**
 * The people list (students, employees): counts, search and quick filters, any field as a filter, the
 * columns each user wants (chosen, ordered and renamed, saved for the signed-in user only), sortable
 * headers, pages, and the same view as a branded Excel or PDF, or saved as a report. What differs
 * between the lists (statuses, counts, the name cell, the row menu, the buttons) comes in `config`.
 */
export function PeopleList<V extends PeopleListView, R extends PeopleListResult<unknown>>({
  config,
  fields,
  initial,
  initialView,
  can,
  reports = [],
  ready = [],
  actions,
}: {
  config: PeopleListConfig<V, R>;
  fields: PeopleListFields;
  initial: R;
  initialView: V;
  can: Record<string, boolean>;
  /** saved reports of this list's kind (mine, then shared with me) to download for the view */
  reports?: ReportChoice[];
  /** ready-made reports of this list (docs/design/52), made at once for the view */
  ready?: Array<{ key: string; name: string; description: string }>;
  actions: {
    load: (q: PeopleListQuery<V>) => Promise<Result<R>>;
    saveView: (v: V) => Promise<void>;
    /** the view as a file made by the workers (watched until ready) … */
    exportFile?: (
      q: PeopleListQuery<V> & { format: 'xlsx' | 'pdf' },
    ) => Promise<Result<{ exportId: string; format: string; spec: ReportSpec }>>;
    /** … or made at once and downloaded */
    download?: (
      q: PeopleListQuery<V> & { format: 'xlsx' | 'pdf' },
    ) => Promise<Result<{ filename: string; contentType: string; base64: string }>>;
    saveReport?: (
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
      q: PeopleListQuery<V> & { format: 'xlsx' | 'pdf' },
    ) => Promise<Result<{ filename: string; contentType: string; base64: string }>>;
  };
}) {
  const router = useRouter();
  const primary = config.primary ?? { key: 'full_name', avatar: true };
  const statusHeader = config.statusHeader ?? 'Status';
  const byKey = useMemo(() => new Map(fields.fields.map((f) => [f.key, f])), [fields]);
  const byLabel = useMemo(
    () => new Map(fields.fields.map((f) => [f.label.toLowerCase(), f])),
    [fields],
  );
  const [view, setView] = useState<V>(initialView);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<R>(initial);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(initialView.search ?? '');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState<{ id: string; format: string } | null>(null);
  // rows ticked for a bulk action (only lists that set `select`); a new page clears them
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();
  const fieldListId = 'sl-fields';

  const load = useCallback(
    (v: V, p: number) =>
      start(async () => {
        const r = await actions.load({ ...v, page: p });
        if (r.ok) {
          setData(r.data);
          setPage(r.data.page);
          setPicked(new Set());
          setError(null);
        } else setError(r.errors?.join('; ') ?? r.error);
      }),
    [actions],
  );

  useEffect(() => {
    config.onMount?.();
    // once, on the first render
  }, []);

  const apply = (next: V, p = 1) => {
    setView(next);
    load(next, p);
    // saved for the signed-in user of this school only; a failed save never blocks the list
    void actions.saveView(next).catch(() => undefined);
  };

  const isQuick = (f: V['filters'][number]) =>
    config.quickFilters.includes(f.key) && (f.op === 'eq' || f.op === 'in');
  const quickOf = (v: V): Record<string, string[]> =>
    Object.fromEntries(v.filters.filter(isQuick).map((f) => [f.key, f.values ?? []]));
  // the filter row is filled first and used on Apply (as on the withdrawal register)
  const [status, setStatus] = useState<V['status']>(initialView.status);
  // each quick filter takes several values (e.g. VI-A and VI-B)
  const [quick, setQuickDraft] = useState<Record<string, string[]>>(() => quickOf(initialView));
  const quickValue = (key: string) => quick[key] ?? [];
  const setQuick = (key: string, value: string[]) => setQuickDraft((q) => ({ ...q, [key]: value }));
  const applyRow = () =>
    apply({
      ...view,
      status,
      search: search.trim(),
      filters: [
        ...view.filters.filter((f) => !isQuick(f)),
        ...Object.entries(quick)
          .filter(([, v]) => v.length)
          .map(([key, v]) => ({ key, op: 'in' as const, values: v })),
      ],
    });
  const clearRow = () => {
    setSearch('');
    setStatus(config.defaultStatus);
    setQuickDraft({});
    apply({ ...view, status: config.defaultStatus, search: '', filters: [] });
  };
  const moreFilters = view.filters.filter((f) => !isQuick(f));

  const sortBy = (key: string) => {
    const cur = view.sort[0];
    const dir: 'asc' | 'desc' = cur?.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
    apply({ ...view, sort: [{ key, dir }] }, 1);
  };
  const sortMark = (key: string) =>
    view.sort[0]?.key === key ? (view.sort[0].dir === 'asc' ? ' ▲' : ' ▼') : '';
  const ariaSort = (key: string): 'ascending' | 'descending' | 'none' =>
    view.sort[0]?.key === key ? (view.sort[0].dir === 'asc' ? 'ascending' : 'descending') : 'none';

  // a file made at once, straight to the browser's downloads
  const save = (f: { filename: string; contentType: string; base64: string }) => {
    const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = f.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const doExport = (format: 'xlsx' | 'pdf') =>
    start(async () => {
      if (actions.download) {
        const d = await actions.download({ ...view, page: 1, format });
        if (!d.ok) return setError(d.errors?.join('; ') ?? d.error);
        setError(null);
        save(d.data);
        return;
      }
      if (!actions.exportFile) return;
      const r = await actions.exportFile({ ...view, page: 1, format });
      if (r.ok) {
        setRunLabel('');
        setExporting({ id: r.data.exportId, format });
      } else setError(r.errors?.join('; ') ?? r.error);
    });

  // a saved report downloaded for what is on screen: its columns, these filters, search and status
  const [runOpen, setRunOpen] = useState(false);
  const [runId, setRunId] = useState('');
  const [runFormat, setRunFormat] = useState<'xlsx' | 'pdf'>('xlsx');
  const [runLabel, setRunLabel] = useState('');
  const savedReports = can.builder && actions.runReport ? reports : [];
  const readyReports = actions.runReady ? ready : [];
  const runReport = () =>
    start(async () => {
      if (runId.startsWith('ready:') && actions.runReady) {
        const d = await actions.runReady(runId.slice(6), { ...view, page: 1, format: runFormat });
        if (!d.ok) return setError(d.errors?.join('; ') ?? d.error);
        setError(null);
        setRunOpen(false);
        save(d.data);
        return;
      }
      const choice = reports.find((r) => r.id === runId);
      if (!choice || !actions.runReport) return setError('Choose a saved report.');
      const r = await actions.runReport(choice.id, runFormat, runtimeOf(config.viewToSpec(view)));
      setRunOpen(false);
      if (r.ok) {
        setRunLabel(choice.name);
        setExporting({ id: r.data.exportId, format: runFormat });
      } else setError(r.errors?.join('; ') ?? r.error);
    });
  const viewFilterCount = config.viewToSpec(view).filters.length;

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(config.report.name);
  const saveAsReport = () =>
    start(async () => {
      if (saveName.trim().length < 3)
        return setError('Give the report a name of at least 3 characters.');
      if (!actions.saveReport) return;
      const r = await actions.saveReport(null, {
        name: saveName.trim(),
        description: config.report.description,
        spec: config.viewToSpec(view),
      });
      if (r.ok) router.push(`/reports/builder/${r.data.id}?ok=1`);
      else {
        setSaveOpen(false);
        setError(r.errors?.join('; ') ?? r.error);
      }
    });

  const counts = config.counts(data);
  const from = data.total ? (page - 1) * view.size + 1 : 0;
  const to = Math.min(page * view.size, data.total);
  const selectable = config.select
    ? data.rows.filter((r) => config.select!.can(r)).map((r) => String(r.__id))
    : [];
  const pickedRows = data.rows.filter((r) => picked.has(String(r.__id)));
  const tick = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const tabs = config.statusTabs?.(data) ?? [];

  return (
    <div className="ep-sl" aria-busy={pending}>
      {tabs.length ? (
        <div
          role="group"
          aria-label="Show"
          style={{
            display: 'flex',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-3)',
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`ep-btn ep-btn--sm ${view.status === t.value ? 'ep-btn--primary' : 'ep-btn--ghost'}`}
              aria-pressed={view.status === t.value}
              disabled={pending}
              onClick={() => {
                setStatus(t.value);
                setSearch('');
                apply({ ...view, status: t.value, search: '' });
              }}
            >
              {t.label}{' '}
              <span className={`ep-badge ep-badge--${t.alert ? 'danger' : 'neutral'}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <section className="ep-card ep-sl__filters" aria-label="Search and filters">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            applyRow();
          }}
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="sl-status" style={{ margin: 0 }}>
            <span className="ep-field__label">Status</span>
            <select
              id="sl-status"
              className="ep-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as V['status'])}
            >
              {config.statuses.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          {config.quickFilters.map((key) => {
            const f = byKey.get(key);
            if (!f) return null;
            return (
              <MultiPick
                key={key}
                id={`sl-q-${key}`}
                label={f.label}
                options={
                  config.quickOptions
                    ? config.quickOptions(key, f.options ?? [], quick, fields)
                    : (f.options ?? [])
                }
                value={quickValue(key)}
                onChange={(v) => setQuick(key, v)}
              />
            );
          })}
          <label className="ep-field" htmlFor="sl-search" style={{ margin: 0 }}>
            <span className="ep-field__label">{config.searchLabel}</span>
            <input
              id="sl-search"
              className="ep-input"
              type="search"
              value={search}
              maxLength={80}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
            Apply
          </button>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={clearRow}>
            Clear
          </button>
        </form>
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
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => {
              setSearch('');
              setStatus(config.defaultStatus);
              setQuickDraft({});
              apply(config.defaultView);
            }}
          >
            Reset view
          </button>
          <span className="ep-sl__count">
            {counts.map(([label, n]) => `${label} ${n.toLocaleString('en-IN')}`).join(' · ')}
          </span>
        </div>
      </section>

      <div className="ep-sl__toolbar">
        <span className="ep-sl__count" aria-live="polite">
          {pending
            ? 'Loading…'
            : `Showing ${String(from)}–${String(to)} of ${data.total.toLocaleString('en-IN')}`}
          {!pending && data.searchedAll ? ` · ${config.searchedAllNote}` : ''}
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
          {savedReports.length || readyReports.length ? (
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                if (!runId)
                  setRunId(readyReports[0] ? `ready:${readyReports[0].key}` : savedReports[0]!.id);
                setRunOpen(true);
              }}
              disabled={pending}
            >
              Download report
            </button>
          ) : null}
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
          {config.tools(can, view)}
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
            queued: `${runLabel || config.report.name} requested`,
            ready: 'Download',
            pending: 'Preparing the file… it downloads automatically',
            failed: 'The file could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}

      {config.select && pickedRows.length ? (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          {config.select.bar(pickedRows, () => {
            setPicked(new Set());
            load(view, page);
          })}
        </div>
      ) : null}
      <div
        className="ep-table-wrap ep-sl__table"
        tabIndex={0}
        role="region"
        aria-label={`${config.noun.heading}s (scrolls sideways)`}
      >
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col" className="ep-sl__sticky" aria-sort={ariaSort(primary.key)}>
                {config.select ? (
                  <input
                    type="checkbox"
                    aria-label={`Tick every ${config.noun.one} on this page that can be ticked`}
                    disabled={!selectable.length}
                    checked={selectable.length > 0 && selectable.every((id) => picked.has(id))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(selectable) : new Set())}
                    style={{ marginRight: 'var(--sp-2)' }}
                  />
                ) : null}
                <button type="button" className="ep-sl__sort" onClick={() => sortBy(primary.key)}>
                  {config.noun.heading}
                  {sortMark(primary.key)}
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
              <th scope="col">{statusHeader}</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const id = String(r.__id);
              const name = String(r[primary.key] ?? '');
              return (
                <tr key={id}>
                  <td className="ep-sl__sticky">
                    <div
                      style={config.select ? { display: 'flex', alignItems: 'center' } : undefined}
                    >
                      {config.select ? (
                        <input
                          type="checkbox"
                          aria-label={`Tick ${name}`}
                          disabled={!config.select.can(r)}
                          checked={picked.has(id)}
                          onChange={(e) => tick(id, e.target.checked)}
                          style={{ marginRight: 'var(--sp-2)' }}
                        />
                      ) : null}
                      <a href={config.rowHref(id, r)} className="ep-sl__who">
                        {!primary.avatar ? null : r.__photo ? (
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
                          {config.identity(r)}
                        </span>
                      </a>
                    </div>
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
                  <td>{config.statusCell(r)}</td>
                  <td>
                    <details className="ep-sl__menu">
                      <summary
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Actions for ${name}`}
                      >
                        Actions ▾
                      </summary>
                      <ul>{config.menu(id, r, can)}</ul>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && !pending ? (
          <p className="ep-field__help" style={{ padding: 'var(--sp-4)' }}>
            No {config.noun.many} match.
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

      {runOpen ? (
        <Dialog
          open
          size="sm"
          title={readyReports.length ? 'Download a report' : 'Download a saved report'}
          onClose={() => setRunOpen(false)}
          primary={{ label: 'Download', loading: pending, onClick: runReport }}
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The report&apos;s columns and layout, for the {config.noun.many} on screen now
            {viewFilterCount || view.search?.trim()
              ? ` (${[
                  viewFilterCount
                    ? `${String(viewFilterCount)} filter${viewFilterCount === 1 ? '' : 's'}`
                    : '',
                  view.search?.trim() ? `search "${view.search.trim()}"` : '',
                ]
                  .filter(Boolean)
                  .join(', ')})`
              : ''}
            .
            {runId.startsWith('ready:')
              ? ''
              : " The report's own filters apply too; a filter on the same field here replaces the report's. The saved report does not change."}
          </p>
          <label className="ep-field" htmlFor="sl-run-report">
            <span className="ep-field__label">Report</span>
            <select
              id="sl-run-report"
              className="ep-select"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
            >
              {readyReports.length ? (
                <optgroup label="Ready-made">
                  {readyReports.map((r) => (
                    <option key={r.key} value={`ready:${r.key}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {savedReports.length ? (
                <optgroup label="My and shared reports">
                  {savedReports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.sharedBy ? `${r.name} (shared by ${r.sharedBy})` : r.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          {runId.startsWith('ready:') ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {readyReports.find((r) => `ready:${r.key}` === runId)?.description}
            </p>
          ) : null}
          {readyReports.length && !savedReports.length && can.builder ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Want your own columns? Arrange the list and use <strong>Save as report</strong>; it
              then shows here too.
            </p>
          ) : null}
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">File</legend>
            <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
              {(
                [
                  ['xlsx', 'Excel'],
                  ['pdf', 'PDF'],
                ] as const
              ).map(([v, l]) => (
                <label key={v} className="ep-check">
                  <input
                    type="radio"
                    name="sl-run-format"
                    checked={runFormat === v}
                    onChange={() => setRunFormat(v)}
                  />{' '}
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        </Dialog>
      ) : null}
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
          help={config.filtersHelp}
          newKey={config.newFilterKey ?? 'religion'}
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
          defaults={config.defaultView.columns}
          placeholder={config.columnSearchPlaceholder}
          heading={config.noun.heading}
          primaryKey={primary.key}
          statusHeader={statusHeader}
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
  help,
  newKey,
  resolve,
  fieldListId,
  onClose,
  onApply,
}: {
  initial: PeopleListView['filters'];
  byKey: Map<string, PeopleListFields['fields'][number]>;
  help?: string;
  newKey: string;
  resolve: (label: string) => PeopleListFields['fields'][number] | undefined;
  fieldListId: string;
  onClose: () => void;
  onApply: (filters: PeopleListView['filters']) => void;
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
        {help ??
          'Add conditions on any field of the profile, fees or transport. They work together with the quick filters above the list; all must match. A condition without a value is ignored.'}
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
        onClick={() => setFilters((p) => [...p, { key: newKey, op: 'in', values: [] }])}
      >
        + Add a condition
      </button>
    </Drawer>
  );
}

function ColumnsDialog({
  fields,
  view,
  defaults,
  placeholder,
  heading,
  primaryKey,
  statusHeader,
  onClose,
  onApply,
}: {
  fields: PeopleListFields;
  view: PeopleListView;
  defaults: PeopleListView['columns'];
  placeholder: string;
  heading: string;
  primaryKey: string;
  statusHeader: string;
  onClose: () => void;
  onApply: (columns: PeopleListView['columns']) => void;
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
          <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setCols(defaults)}>
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
              placeholder={placeholder}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="ep-sl__colpick">
            {fields.sections.map((s) => {
              const list = fields.fields.filter(
                (f) =>
                  f.section === s.id &&
                  f.key !== primaryKey &&
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
            Drag or use the arrows. Type a header to rename a column. {heading} and {statusHeader}{' '}
            always show.
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
