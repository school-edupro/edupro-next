'use client';
import { Dialog } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition } from 'react';
import { ExportWatcher } from './ExportWatcher';
import {
  OP_LABELS,
  opsFor,
  type BuilderField,
  type BuilderFields,
  type FilterOp,
  type PreviewResult,
  type ReportSpec,
  type Result,
  type SavedReport,
} from '@/lib/report-builder';

type ShareRow = { userId?: string; roleId?: string; name: string; canEdit: boolean };

export interface ReportBuilderActions {
  preview: (spec: ReportSpec) => Promise<Result<PreviewResult>>;
  save: (
    id: string | null,
    input: { name: string; description: string | null; spec: ReportSpec },
  ) => Promise<Result<SavedReport>>;
  copy: (id: string, name: string) => Promise<Result<SavedReport>>;
  exportFile: (
    id: string,
    format: 'xlsx' | 'pdf',
  ) => Promise<Result<{ exportId: string; format: string }>>;
  shareOptions: (q: string) => Promise<{
    users: Array<{ id: string; name: string; detail: string | null }>;
    roles: Array<{ id: string; name: string; code: string }>;
  }>;
  saveShares: (
    id: string,
    shares: Array<{ userId?: string; roleId?: string; canEdit: boolean }>,
  ) => Promise<Result<SavedReport>>;
}

/**
 * The report builder: pick columns from every student profile field, put them in order, write the
 * header each column should carry, add filters and a sort, preview live, save, share and download a
 * branded Excel or PDF.
 */
export function ReportBuilder({
  fields,
  report,
  initialSpec,
  actions,
}: {
  fields: BuilderFields;
  report: SavedReport | null;
  initialSpec: ReportSpec;
  actions: ReportBuilderActions;
}) {
  const router = useRouter();
  const byKey = useMemo(() => new Map(fields.fields.map((f) => [f.key, f])), [fields]);
  const byLabel = useMemo(
    () => new Map(fields.fields.map((f) => [f.label.toLowerCase(), f])),
    [fields],
  );
  const [saved, setSaved] = useState<SavedReport | null>(report);
  const [name, setName] = useState(report?.name ?? '');
  const [description, setDescription] = useState(report?.description ?? '');
  const [spec, setSpec] = useState<ReportSpec>(initialSpec);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'info';
    text: string;
  } | null>(null);
  const [exporting, setExporting] = useState<{ id: string; format: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const canEdit = !saved || saved.canEdit;
  const dirty =
    !saved ||
    JSON.stringify(saved.spec) !== JSON.stringify(spec) ||
    saved.name !== name ||
    (saved.description ?? '') !== description;
  const pdfLimit = fields.pdfColumnLimit[spec.options.paper];
  const fieldListId = useId();

  const chosen = new Set(spec.columns.map((c) => c.key));
  const q = search.trim().toLowerCase();
  const setColumns = (columns: ReportSpec['columns']) => setSpec((s) => ({ ...s, columns }));
  const toggle = (key: string) =>
    setColumns(
      chosen.has(key) ? spec.columns.filter((c) => c.key !== key) : [...spec.columns, { key }],
    );
  const move = (from: number, to: number) => {
    if (to < 0 || to >= spec.columns.length || from === to) return;
    const next = [...spec.columns];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setColumns(next);
  };

  const run = (fn: () => Promise<void>) => start(fn);
  const fail = (r: { error: string; errors?: string[] }) =>
    setNotice({ tone: 'danger', text: r.errors?.length ? r.errors.join('; ') : r.error });

  const doPreview = () =>
    run(async () => {
      const r = await actions.preview(spec);
      if (r.ok) {
        setPreview(r.data);
        setNotice(null);
      } else fail(r);
    });

  const doSave = (asNew = false) =>
    run(async () => {
      if (name.trim().length < 3) {
        setNotice({ tone: 'danger', text: 'Give the report a name of at least 3 characters.' });
        document.getElementById('rb-name')?.focus();
        return;
      }
      const r =
        asNew && saved
          ? await actions.copy(
              saved.id,
              name.trim() === saved.name ? `${name.trim()} (copy)` : name.trim(),
            )
          : await actions.save(saved && !asNew ? saved.id : null, {
              name: name.trim(),
              description: description.trim() || null,
              spec,
            });
      if (!r.ok) return fail(r);
      if (asNew && saved && r.ok) {
        // the copy carries the saved spec; bring over any unsaved edits too
        const upd = await actions.save(r.data.id, {
          name: r.data.name,
          description: description.trim() || null,
          spec,
        });
        if (!upd.ok) return fail(upd);
        setNotice({ tone: 'success', text: `Saved as "${upd.data.name}".` });
        router.push(`/reports/builder/${upd.data.id}`);
        return;
      }
      setSaved(r.data);
      setName(r.data.name);
      setNotice({ tone: 'success', text: `Saved "${r.data.name}".` });
      if (!saved) router.replace(`/reports/builder/${r.data.id}?ok=1`);
      router.refresh();
    });

  const doExport = (format: 'xlsx' | 'pdf') =>
    run(async () => {
      if (!saved || dirty) {
        setNotice({
          tone: 'info',
          text: 'Save the report first; downloads use the saved version.',
        });
        return;
      }
      const r = await actions.exportFile(saved.id, format);
      if (!r.ok) return fail(r);
      setExporting({ id: r.data.exportId, format });
      setNotice(null);
    });

  return (
    <div className="ep-rb">
      <div className="ep-profile__bar" role="region" aria-label="Report actions">
        <div className="ep-rb__name">
          <label className="ep-field" htmlFor="rb-name">
            <span className="ep-field__label">Report name *</span>
            <input
              id="rb-name"
              className="ep-input"
              value={name}
              maxLength={120}
              readOnly={!canEdit}
              placeholder="e.g. Class VI girls with transport"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="ep-field" htmlFor="rb-desc">
            <span className="ep-field__label">Description</span>
            <input
              id="rb-desc"
              className="ep-input"
              value={description}
              maxLength={500}
              readOnly={!canEdit}
              placeholder="What this report is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <div className="ep-rb__buttons">
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={doPreview}
            disabled={pending}
          >
            Preview
          </button>
          {canEdit ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              onClick={() => doSave(false)}
              disabled={pending || !dirty}
            >
              {saved ? 'Save' : 'Save report'}
            </button>
          ) : null}
          {saved ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => doSave(true)}
              disabled={pending}
            >
              Save as new
            </button>
          ) : null}
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => doExport('xlsx')}
            disabled={pending || !saved}
          >
            Excel
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => doExport('pdf')}
            disabled={pending || !saved || spec.columns.length > pdfLimit}
            title={
              spec.columns.length > pdfLimit
                ? `A PDF on ${spec.options.paper} holds ${String(pdfLimit)} columns`
                : undefined
            }
          >
            PDF
          </button>
          {saved?.canShare ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setShareOpen(true)}
              disabled={pending}
            >
              Share{saved.shares.length ? ` (${String(saved.shares.length)})` : ''}
            </button>
          ) : null}
        </div>
      </div>
      {saved && !saved.isOwner ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Shared by {saved.ownerName ?? 'a colleague'} ·{' '}
          {saved.canEdit
            ? 'you can edit it'
            : 'view only: change it and use "Save as new" to keep your own version'}
        </div>
      ) : null}
      {notice ? (
        <div
          className={`ep-alert ep-alert--${notice.tone}`}
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {notice.text}
        </div>
      ) : null}
      {exporting ? (
        <ExportWatcher
          id={exporting.id}
          format={exporting.format}
          labels={{
            queued: 'Report requested',
            ready: 'Download',
            pending: 'Preparing the file… it downloads automatically',
            failed: 'The file could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}

      <div className="ep-rb__layout">
        {/* ---- field picker ---- */}
        <section className="ep-card ep-rb__picker" aria-label="Available fields">
          <h2 className="ep-card__title">Fields</h2>
          <label className="ep-field" htmlFor="rb-search">
            <span className="ep-field__label">Search fields</span>
            <input
              id="rb-search"
              className="ep-input"
              value={search}
              placeholder="e.g. mobile, religion, route"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <p className="ep-field__help">
            {spec.columns.length} of {fields.fields.length} chosen
          </p>
          {fields.sections.map((s) => {
            const list = fields.fields.filter(
              (f) =>
                f.section === s.id &&
                (!q || f.label.toLowerCase().includes(q) || f.key.includes(q)),
            );
            if (!list.length) return null;
            const picked = list.filter((f) => chosen.has(f.key)).length;
            return (
              <details key={s.id} open={Boolean(q) || s.id === 'student'}>
                <summary>
                  {s.title}{' '}
                  <span className="ep-field__help">
                    ({picked}/{list.length})
                  </span>
                </summary>
                <ul className="ep-rb__fieldlist">
                  {list.map((f) => (
                    <li key={f.key}>
                      <label>
                        <input
                          type="checkbox"
                          checked={chosen.has(f.key)}
                          disabled={!canEdit}
                          onChange={() => toggle(f.key)}
                        />{' '}
                        {f.label}
                        {f.masked ? <span className="ep-field__help"> (masked)</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </section>

        <div className="ep-rb__main">
          {/* ---- columns ---- */}
          <section
            className="ep-card"
            aria-label="Columns and headers"
            style={{ padding: 'var(--sp-4)' }}
          >
            <h2 className="ep-card__title">Columns and headers</h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Drag or use the arrows to set the order. The header is what Excel and PDF show; leave
              it empty to use the field name.{' '}
              {spec.columns.length > pdfLimit
                ? `PDF on ${spec.options.paper} holds ${String(pdfLimit)} columns: choose fewer, switch to A3, or use Excel.`
                : `PDF on ${spec.options.paper}: up to ${String(pdfLimit)} columns.`}
            </p>
            <ol className="ep-rb__columns">
              {spec.columns.map((c, i) => {
                const f = byKey.get(c.key);
                return (
                  <li
                    key={c.key}
                    draggable={canEdit}
                    onDragStart={() => setDragFrom(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom !== null) move(dragFrom, i);
                      setDragFrom(null);
                    }}
                    className="ep-rb__column"
                  >
                    <span className="ep-rb__grip" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className="ep-rb__index">{i + 1}</span>
                    <label className="ep-rb__header" htmlFor={`rb-h-${c.key}`}>
                      <span className="ep-field__help">{f?.label ?? c.key}</span>
                      <input
                        id={`rb-h-${c.key}`}
                        className="ep-input"
                        value={c.label ?? ''}
                        placeholder={f?.label ?? c.key}
                        maxLength={80}
                        readOnly={!canEdit}
                        aria-label={`Header for ${f?.label ?? c.key}`}
                        onChange={(e) =>
                          setColumns(
                            spec.columns.map((x, j) =>
                              j === i ? { ...x, label: e.target.value || null } : x,
                            ),
                          )
                        }
                      />
                    </label>
                    {canEdit ? (
                      <span className="ep-rb__colbtns">
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${f?.label ?? c.key} up`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${f?.label ?? c.key} down`}
                          disabled={i === spec.columns.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${f?.label ?? c.key}`}
                          onClick={() => toggle(c.key)}
                        >
                          ✕
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {!spec.columns.length ? (
              <p className="ep-field__help">Tick fields on the left to add columns.</p>
            ) : null}
          </section>

          {/* ---- filters ---- */}
          <section className="ep-card" aria-label="Filters" style={{ padding: 'var(--sp-4)' }}>
            <h2 className="ep-card__title">Filters</h2>
            <datalist id={fieldListId}>
              {fields.fields.map((f) => (
                <option key={f.key} value={f.label} />
              ))}
            </datalist>
            {spec.filters.map((flt, i) => (
              <FilterRow
                key={`${String(i)}-${flt.key}`}
                index={i}
                filter={flt}
                field={byKey.get(flt.key)}
                fieldListId={fieldListId}
                disabled={!canEdit}
                resolve={(label) => byLabel.get(label.trim().toLowerCase())}
                onChange={(next) =>
                  setSpec((s) => ({ ...s, filters: s.filters.map((x, j) => (j === i ? next : x)) }))
                }
                onRemove={() =>
                  setSpec((s) => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }))
                }
              />
            ))}
            {canEdit ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() =>
                  setSpec((s) => ({
                    ...s,
                    filters: [...s.filters, { key: 'class_section', op: 'in', values: [] }],
                  }))
                }
              >
                + Add filter
              </button>
            ) : null}
            {!spec.filters.length ? (
              <p className="ep-field__help">No filters: every student of the year.</p>
            ) : null}
          </section>

          {/* ---- sort and options ---- */}
          <section
            className="ep-card"
            aria-label="Sort and page"
            style={{ padding: 'var(--sp-4)' }}
          >
            <h2 className="ep-card__title">Sort and page</h2>
            <div className="ep-profile__grid">
              {[0, 1, 2].map((i) => {
                const s = spec.sort[i];
                return (
                  <div key={i} className="ep-field">
                    <label className="ep-field__label" htmlFor={`rb-sort-${String(i)}`}>
                      {i === 0 ? 'Sort by' : 'Then by'}
                    </label>
                    <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                      <input
                        id={`rb-sort-${String(i)}`}
                        className="ep-input"
                        list={fieldListId}
                        autoComplete="off"
                        disabled={!canEdit || (i > 0 && !spec.sort[i - 1])}
                        defaultValue={s ? (byKey.get(s.key)?.label ?? s.key) : ''}
                        onChange={(e) => {
                          const f = byLabel.get(e.target.value.trim().toLowerCase());
                          const text = e.target.value.trim();
                          setSpec((sp) => {
                            const sort = [...sp.sort];
                            if (!text) sort.splice(i);
                            else if (f) sort[i] = { key: f.key, dir: sort[i]?.dir ?? 'asc' };
                            return { ...sp, sort: sort.filter(Boolean) };
                          });
                        }}
                      />
                      <select
                        className="ep-input"
                        aria-label={`Direction ${String(i + 1)}`}
                        value={s?.dir ?? 'asc'}
                        disabled={!canEdit || !s}
                        onChange={(e) =>
                          setSpec((sp) => ({
                            ...sp,
                            sort: sp.sort.map((x, j) =>
                              j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x,
                            ),
                          }))
                        }
                      >
                        <option value="asc">A → Z / low → high</option>
                        <option value="desc">Z → A / high → low</option>
                      </select>
                    </div>
                  </div>
                );
              })}
              <label className="ep-field" htmlFor="rb-year">
                <span className="ep-field__label">Academic year</span>
                <select
                  id="rb-year"
                  className="ep-input"
                  value={spec.options.academicYearId ?? ''}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      options: { ...s.options, academicYearId: e.target.value || null },
                    }))
                  }
                >
                  <option value="">Working year</option>
                  {fields.years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code} ({y.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="rb-paper">
                <span className="ep-field__label">Paper (PDF and print)</span>
                <select
                  id="rb-paper"
                  className="ep-input"
                  value={spec.options.paper}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      options: { ...s.options, paper: e.target.value as 'A4' | 'A3' },
                    }))
                  }
                >
                  <option value="A4">A4 (up to {fields.pdfColumnLimit.A4} columns in PDF)</option>
                  <option value="A3">A3 (up to {fields.pdfColumnLimit.A3} columns in PDF)</option>
                </select>
              </label>
              <label className="ep-field" htmlFor="rb-orientation">
                <span className="ep-field__label">Orientation</span>
                <select
                  id="rb-orientation"
                  className="ep-input"
                  value={spec.options.orientation}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      options: {
                        ...s.options,
                        orientation: e.target.value as ReportSpec['options']['orientation'],
                      },
                    }))
                  }
                >
                  <option value="auto">Automatic (landscape above 7 columns)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={spec.options.includeInactive ?? false}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      options: { ...s.options, includeInactive: e.target.checked },
                    }))
                  }
                />
                Include inactive and left students
              </label>
            </div>
          </section>

          {/* ---- preview ---- */}
          {preview ? (
            <section className="ep-card" aria-label="Preview" style={{ padding: 'var(--sp-4)' }}>
              <h2 className="ep-card__title">
                Preview · {preview.total} student{preview.total === 1 ? '' : 's'} ·{' '}
                {preview.academicYear}
              </h2>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Filters: {preview.filtersText.length ? preview.filtersText.join('; ') : 'none'}
                {preview.total > preview.rows.length
                  ? ` · showing the first ${String(preview.rows.length)}`
                  : ''}
              </p>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Preview rows (scrolls sideways)">
                <table className="ep-table">
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c.key} scope="col">
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c.key}>
                            {r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {shareOpen && saved ? (
        <SharePanel
          report={saved}
          actions={actions}
          onClose={() => setShareOpen(false)}
          onSaved={(r) => {
            setSaved(r);
            setShareOpen(false);
            setNotice({
              tone: 'success',
              text: r.shares.length
                ? `Shared with ${r.shares.map((s) => `${s.name}${s.canEdit ? ' (can edit)' : ''}`).join(', ')}.`
                : 'No longer shared.',
            });
          }}
        />
      ) : null}
    </div>
  );
}

function FilterRow({
  index,
  filter,
  field,
  fieldListId,
  disabled,
  resolve,
  onChange,
  onRemove,
}: {
  index: number;
  filter: ReportSpec['filters'][number];
  field: BuilderField | undefined;
  fieldListId: string;
  disabled: boolean;
  resolve: (label: string) => BuilderField | undefined;
  onChange: (next: ReportSpec['filters'][number]) => void;
  onRemove: () => void;
}) {
  const optionsId = useId();
  const [draft, setDraft] = useState('');
  const values = filter.values ?? [];
  const ops = field ? opsFor(field.type) : (['eq'] as FilterOp[]);
  const multi = filter.op === 'in' || filter.op === 'not_in';
  const noValue = filter.op === 'empty' || filter.op === 'not_empty';
  const inputType = field?.type === 'date' ? 'date' : 'text';
  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange({ ...filter, values: [...values, v] });
    setDraft('');
  };
  const n = String(index + 1);
  return (
    <div className="ep-rb__filter">
      <label className="ep-field" htmlFor={`rb-f-${n}`}>
        <span className="ep-field__label">Field</span>
        <input
          id={`rb-f-${n}`}
          className="ep-input"
          list={fieldListId}
          autoComplete="off"
          disabled={disabled}
          defaultValue={field?.label ?? filter.key}
          onChange={(e) => {
            const f = resolve(e.target.value);
            if (f) {
              const nextOps = opsFor(f.type);
              onChange({
                key: f.key,
                op: nextOps.includes(filter.op) ? filter.op : nextOps[0]!,
                values: [],
              });
            }
          }}
        />
      </label>
      <label className="ep-field" htmlFor={`rb-op-${n}`}>
        <span className="ep-field__label">Condition</span>
        <select
          id={`rb-op-${n}`}
          className="ep-input"
          value={filter.op}
          disabled={disabled}
          onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp, values: [] })}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABELS[o]}
            </option>
          ))}
        </select>
      </label>
      {noValue ? (
        <span />
      ) : multi ? (
        <div className="ep-field">
          <label className="ep-field__label" htmlFor={`rb-v-${n}`}>
            Values
          </label>
          <div className="ep-rb__chips">
            {values.map((v) => (
              <span key={v} className="ep-badge ep-badge--info">
                {v}{' '}
                {!disabled ? (
                  <button
                    type="button"
                    className="ep-rb__chipx"
                    aria-label={`Remove ${v}`}
                    onClick={() => onChange({ ...filter, values: values.filter((x) => x !== v) })}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            <input
              id={`rb-v-${n}`}
              className="ep-input"
              list={field?.options ? optionsId : undefined}
              autoComplete="off"
              value={draft}
              disabled={disabled}
              placeholder="Type or pick, then Add"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={add}
              disabled={disabled}
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <div className="ep-field">
          <label className="ep-field__label" htmlFor={`rb-v-${n}`}>
            {filter.op === 'between' ? 'From / to' : 'Value'}
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
            {(filter.op === 'between' ? [0, 1] : [0]).map((k) => (
              <input
                key={k}
                id={k === 0 ? `rb-v-${n}` : `rb-v-${n}-to`}
                aria-label={k === 0 ? undefined : 'To'}
                className="ep-input"
                type={inputType}
                list={field?.options && inputType === 'text' ? optionsId : undefined}
                autoComplete="off"
                disabled={disabled}
                value={values[k] ?? ''}
                onChange={(e) => {
                  const next = [...values];
                  next[k] = e.target.value;
                  onChange({ ...filter, values: next });
                }}
              />
            ))}
          </div>
        </div>
      )}
      {field?.options ? (
        <datalist id={optionsId}>
          {field.options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
      {!disabled ? (
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm ep-rb__remove"
          aria-label={`Remove filter ${n}`}
          onClick={onRemove}
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function SharePanel({
  report,
  actions,
  onClose,
  onSaved,
}: {
  report: SavedReport;
  actions: ReportBuilderActions;
  onClose: () => void;
  onSaved: (r: SavedReport) => void;
}) {
  const [rows, setRows] = useState<ShareRow[]>(
    report.shares.map((s) => ({
      userId: s.userId ?? undefined,
      roleId: s.roleId ?? undefined,
      name: s.name,
      canEdit: s.canEdit,
    })),
  );
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{
    users: Array<{ id: string; name: string; detail: string | null }>;
    roles: Array<{ id: string; name: string; code: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const search = () => start(async () => setFound(await actions.shareOptions(q)));
  const has = (r: ShareRow) =>
    rows.some((x) => (r.userId ? x.userId === r.userId : x.roleId === r.roleId));
  const add = (r: ShareRow) => {
    if (!has(r)) setRows((p) => [...p, r]);
  };
  return (
    <Dialog
      open
      size="lg"
      title={`Share "${report.name}"`}
      onClose={onClose}
      primary={{
        label: 'Save sharing',
        loading: pending,
        onClick: () =>
          start(async () => {
            const r = await actions.saveShares(
              report.id,
              rows.map((x) =>
                x.userId
                  ? { userId: x.userId, canEdit: x.canEdit }
                  : { roleId: x.roleId!, canEdit: x.canEdit },
              ),
            );
            if (r.ok) onSaved(r.data);
            else setError(r.errors?.join('; ') ?? r.error);
          }),
      }}
    >
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        People you share with see this report under "Shared with me". View only lets them run and
        download it; can edit lets them change its columns and filters. They still see only the
        students their own access allows.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <label className="ep-field" htmlFor="rb-share-q" style={{ flex: 1 }}>
          <span className="ep-field__label">Find a colleague or a role</span>
          <input
            id="rb-share-q"
            className="ep-input"
            value={q}
            placeholder="Name or email (2 letters or more)"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          onClick={search}
          disabled={pending}
        >
          Search
        </button>
      </div>
      {found ? (
        <div className="ep-rb__found">
          {found.users.map((u) => (
            <button
              key={`u${u.id}`}
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={has({ userId: u.id, name: u.name, canEdit: false })}
              onClick={() => add({ userId: u.id, name: u.name, canEdit: false })}
            >
              + {u.name}
              {u.detail ? ` · ${u.detail}` : ''}
            </button>
          ))}
          {found.roles
            .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
            .map((r) => (
              <button
                key={`r${r.id}`}
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                disabled={has({ roleId: r.id, name: r.name, canEdit: false })}
                onClick={() => add({ roleId: r.id, name: `Role: ${r.name}`, canEdit: false })}
              >
                + Role: {r.name}
              </button>
            ))}
          {!found.users.length && !found.roles.length ? (
            <p className="ep-field__help">Nobody found.</p>
          ) : null}
        </div>
      ) : null}
      <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-3)' }}>
        Shared with
      </h3>
      {rows.length ? (
        <ul className="ep-rb__shares">
          {rows.map((r, i) => (
            <li key={r.userId ? `u${r.userId}` : `r${r.roleId ?? ''}`}>
              <span>{r.name}</span>
              <label>
                <input
                  type="checkbox"
                  checked={r.canEdit}
                  onChange={(e) =>
                    setRows((p) =>
                      p.map((x, j) => (j === i ? { ...x, canEdit: e.target.checked } : x)),
                    )
                  }
                />{' '}
                Can edit
              </label>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ep-field__help">Not shared. Only you can see this report.</p>
      )}
      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
