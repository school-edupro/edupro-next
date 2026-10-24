'use client';
import {
  ADMISSION_FIELD_TYPES,
  AdmissionFormFill,
  Badge,
  defProblems,
  Drawer,
  OPTION_SOURCES,
  PRESETS,
  RULE_OPS,
  type AdmissionField,
  type AdmissionFieldType,
  type AdmissionFormDef,
  type AdmissionRule,
} from '@edupro/ui';
import { useMemo, useState, useTransition } from 'react';
import { saveAdmissionForm } from '@/lib/admission-form-actions';
import type { FormDetail, FormMeta } from '@/lib/admission-forms';

const TYPE_LABEL: Record<AdmissionFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  email: 'Email',
  mobile: 'Mobile number',
  date: 'Date',
  select: 'Drop-down',
  radio: 'Choose one',
  checkbox: 'Choose several',
  yesno: 'Yes / No',
  file: 'Document upload',
  photo: 'Photo upload',
  heading: 'Heading',
  note: 'Note / text block',
  age: 'Age as on (worked out)',
  siblings: 'Siblings in school (look-up)',
  subjects: 'Subjects by stream',
  marks: 'Marks with cut-offs',
  address_same: '"Same as" box (copies fields)',
  agree: 'I agree box',
  signature: 'Typed signature',
};
const PRESET_LABEL: Record<string, string> = {
  aadhaar: 'Aadhaar (12 digits)',
  apaar: 'APAAR ID (12 digits)',
  pen: 'PEN number',
  udise: 'UDISE (11 digits)',
  mobile: 'Mobile (10 digits, 6-9)',
  pincode: 'PIN code (6 digits, allowed series)',
  cbse_roll: 'CBSE roll no',
  year: 'Year (4 digits, before pass-out limit)',
  pan: 'PAN',
  name: 'Name without titles (Mr., Dr. …)',
};
const SOURCE_LABEL: Record<string, string> = {
  classes: 'Classes',
  subjects: 'Subjects',
  cities: 'Cities (System setup)',
  states: 'States (System setup)',
  countries: 'Countries (System setup)',
  houses: 'Houses',
};
const OP_LABEL: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of (a|b)',
  not_in: 'is none of (a|b)',
  empty: 'is empty',
  not_empty: 'is answered',
  gt: 'is more than',
  lt: 'is less than',
};
const ACTION_LABEL: Record<AdmissionRule['action'], string> = {
  show: 'Show only when',
  hide: 'Hide when',
  require: 'Required when',
  optional: 'Not required when',
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
    .slice(0, 40) || 'field';

/**
 * The admission form builder (docs/design/39, part 1): tabs; fields with their type, options (a school
 * list, a master or typed), checks, rules (show / hide / require), and where the answer goes in the
 * student master (or "copy to student master" as an additional field); settings; a live preview that
 * runs the same rules as the candidate portal.
 */
export function FormBuilder({
  form,
  meta,
  canEdit,
}: {
  form: FormDetail;
  meta: FormMeta;
  canEdit: boolean;
}) {
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description ?? '');
  const [def, setDef] = useState<AdmissionFormDef>(form.def);
  const [view, setView] = useState<'build' | 'settings' | 'preview'>('build');
  const [stepKey, setStepKey] = useState(form.def.steps[0]?.key ?? '');
  const [editing, setEditing] = useState<{ index: number; field: AdmissionField } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  // the version this page is editing; a save made elsewhere since then is not overwritten unasked
  const [base, setBase] = useState(form.updatedAt);
  const [stale, setStale] = useState<{ updatedAt: string; updatedBy: string | null } | null>(null);

  const problems = useMemo(() => defProblems(def), [def]);
  const options = form.options;
  const update = (fn: (d: AdmissionFormDef) => AdmissionFormDef) => {
    setDef((d) => fn(d));
    setDirty(true);
    setMsg(null);
  };
  const stepFields = def.fields.map((f, i) => ({ f, i })).filter((x) => x.f.step === stepKey);
  const studentField = (key?: string) => meta.studentFields.find((s) => s.key === key);

  const save = (over?: string) =>
    start(async () => {
      const r = await saveAdmissionForm(form.id, {
        name,
        description,
        def,
        baseUpdatedAt: over ?? base,
      });
      if (r.ok) {
        setBase(r.data.updatedAt);
        setStale(null);
        setDirty(false);
        setMsg({ tone: 'success', text: 'Form saved.' });
      } else if ('stale' in r) {
        setStale(r.stale);
        setMsg(null);
      } else setMsg({ tone: 'danger', text: r.error });
    });

  const moveField = (i: number, d: -1 | 1) =>
    update((x) => {
      const same = x.fields.map((f, j) => ({ f, j })).filter((y) => y.f.step === x.fields[i]!.step);
      const pos = same.findIndex((y) => y.j === i);
      const other = same[pos + d];
      if (!other) return x;
      const fields = [...x.fields];
      [fields[i], fields[other.j]] = [fields[other.j]!, fields[i]!];
      return { ...x, fields };
    });

  const addStep = () => {
    const title = window.prompt('Name of the new tab', 'New tab');
    if (!title) return;
    let key = slug(title);
    while (def.steps.some((s) => s.key === key)) key = `${key}_2`.slice(0, 40);
    update((x) => ({ ...x, steps: [...x.steps, { key, title: title.slice(0, 80) }] }));
    setStepKey(key);
  };

  return (
    <div className="ep-fb">
      <div className="ep-fb__top">
        <label className="ep-field">
          <span className="ep-field__label">Form name *</span>
          <input
            className="ep-input"
            value={name}
            disabled={!canEdit}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Description</span>
          <input
            className="ep-input"
            value={description}
            disabled={!canEdit}
            maxLength={500}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </div>
      <div className="ep-fb__views" role="tablist" aria-label="Builder views">
        {(['build', 'settings', 'preview'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className="ep-fb__view"
            onClick={() => setView(v)}
          >
            {v === 'build' ? 'Tabs and fields' : v === 'settings' ? 'Form settings' : 'Preview'}
          </button>
        ))}
      </div>

      {view === 'build' ? (
        <div className="ep-fb__build">
          <aside className="ep-fb__steps" aria-label="Tabs of the form">
            <h3>Tabs</h3>
            <ol>
              {def.steps.map((s, i) => (
                <li key={s.key} data-active={s.key === stepKey || undefined}>
                  <button
                    type="button"
                    className="ep-fb__stepbtn"
                    aria-current={s.key === stepKey ? 'true' : undefined}
                    onClick={() => setStepKey(s.key)}
                  >
                    <span className="ep-fb__stepno">{i + 1}</span>
                    {s.title}
                    <span className="ep-fb__count">
                      {def.fields.filter((f) => f.step === s.key).length}
                    </span>
                  </button>
                  {canEdit ? (
                    <span className="ep-fb__stepacts">
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Rename tab ${s.title}`}
                        onClick={() => {
                          const t = window.prompt('Tab name', s.title);
                          if (t)
                            update((x) => ({
                              ...x,
                              steps: x.steps.map((y) =>
                                y.key === s.key ? { ...y, title: t.slice(0, 80) } : y,
                              ),
                            }));
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move tab ${s.title} up`}
                        disabled={i === 0}
                        onClick={() =>
                          update((x) => {
                            const steps = [...x.steps];
                            [steps[i - 1], steps[i]] = [steps[i]!, steps[i - 1]!];
                            return { ...x, steps };
                          })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Remove tab ${s.title}`}
                        onClick={() => {
                          if (def.fields.some((f) => f.step === s.key)) {
                            window.alert('Move or remove the fields of this tab first.');
                            return;
                          }
                          update((x) => ({ ...x, steps: x.steps.filter((y) => y.key !== s.key) }));
                          setStepKey(def.steps[0]?.key ?? '');
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            {canEdit ? (
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={addStep}
              >
                Add a tab
              </button>
            ) : null}
          </aside>
          <section className="ep-fb__fields" aria-label="Fields of the tab">
            <div className="ep-fb__fieldshead">
              <h3>{def.steps.find((s) => s.key === stepKey)?.title ?? 'Fields'}</h3>
              {canEdit ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  onClick={() =>
                    setEditing({
                      index: -1,
                      field: { key: '', label: '', type: 'text', step: stepKey, width: 'half' },
                    })
                  }
                >
                  Add a field
                </button>
              ) : null}
            </div>
            {stepFields.length === 0 ? (
              <p className="ep-field__help">No fields on this tab yet.</p>
            ) : null}
            <ul className="ep-fb__list">
              {stepFields.map(({ f, i }, n) => {
                const m = studentField(f.maps);
                return (
                  <li key={f.key} className="ep-fb__item">
                    <div className="ep-fb__itemmain">
                      <strong>{f.label}</strong>
                      <span className="ep-fb__meta">
                        <Badge tone="neutral">{TYPE_LABEL[f.type]}</Badge>
                        {f.required ? <Badge tone="warning">Required</Badge> : null}
                        {f.rules?.length ? (
                          <Badge tone="info">
                            {f.rules.length === 1 ? '1 rule' : `${String(f.rules.length)} rules`}
                          </Badge>
                        ) : null}
                        {m ? (
                          <Badge tone="success">Student master: {m.label}</Badge>
                        ) : f.copy ? (
                          <Badge tone="success">Additional student field</Badge>
                        ) : f.docKind ? (
                          <Badge tone="success">
                            Document:{' '}
                            {meta.docKinds.find((k) => k.id === f.docKind)?.label ?? f.docKind}
                          </Badge>
                        ) : ['heading', 'note', 'agree', 'address_same', 'age'].includes(
                            f.type,
                          ) ? null : (
                          <Badge tone="neutral">Application only</Badge>
                        )}
                        {f.list ? (
                          <span className="ep-field__help">List: {f.list}</span>
                        ) : f.source ? (
                          <span className="ep-field__help">Master: {SOURCE_LABEL[f.source]}</span>
                        ) : null}
                      </span>
                    </div>
                    {canEdit ? (
                      <span className="ep-fb__itemacts">
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${f.label} up`}
                          disabled={n === 0}
                          onClick={() => moveField(i, -1)}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${f.label} down`}
                          disabled={n === stepFields.length - 1}
                          onClick={() => moveField(i, 1)}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          aria-label={`Edit ${f.label}`}
                          onClick={() => setEditing({ index: i, field: structuredClone(f) })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${f.label}`}
                          onClick={() => {
                            if (window.confirm(`Remove "${f.label}" from the form?`))
                              update((x) => ({ ...x, fields: x.fields.filter((_, j) => j !== i) }));
                          }}
                        >
                          Remove
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}

      {view === 'settings' ? <SettingsPanel def={def} canEdit={canEdit} update={update} /> : null}

      {view === 'preview' ? (
        <div className="ep-fb__preview">
          <p className="ep-alert ep-alert--info">
            The candidate&rsquo;s view, with the same checks. Nothing typed here is saved; uploads
            are off.
          </p>
          <AdmissionFormFill
            def={def}
            options={options}
            preview
            onLookupSibling={async (no) => ({ name: `Sample pupil ${no}`, classSection: 'VI-A' })}
          />
        </div>
      ) : null}

      {problems.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <strong>Check before saving:</strong>
          <ul>
            {problems.slice(0, 6).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {canEdit ? (
        <div
          className={`ep-fb__bar${stale ? ' ep-fb__bar--stale' : ''}`}
          role="region"
          aria-label="Save the form"
        >
          {stale ? (
            <>
              <span className="ep-fb__msg" role="alert">
                <strong>This form was changed after you opened it</strong>:{' '}
                {stale.updatedBy ?? 'someone'} saved it at{' '}
                {new Date(stale.updatedAt).toLocaleString('en-IN')}. Reload to see their version
                (your changes here are lost), or replace it with yours.
              </span>
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                onClick={() => window.location.reload()}
              >
                Reload their version
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--danger"
                disabled={pending || problems.length > 0}
                onClick={() => save(stale.updatedAt)}
              >
                {pending ? 'Saving…' : 'Replace with mine'}
              </button>
            </>
          ) : (
            <>
              <span className="ep-fb__msg" role={msg?.tone === 'danger' ? 'alert' : 'status'}>
                {msg
                  ? msg.text
                  : dirty
                    ? 'Unsaved changes'
                    : `Saved ${new Date(base).toLocaleString('en-IN')}${form.updatedBy ? ` by ${form.updatedBy}` : ''}`}
              </span>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending || !dirty || problems.length > 0}
                onClick={() => save()}
              >
                {pending ? 'Saving…' : 'Save form'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {editing ? (
        <FieldEditor
          key={editing.index}
          initial={editing.field}
          isNew={editing.index < 0}
          def={def}
          meta={meta}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            update((x) => {
              const fields = [...x.fields];
              if (editing.index < 0) {
                // after the last field of its tab
                const lastOfStep = fields
                  .map((y, j) => (y.step === f.step ? j : -1))
                  .filter((j) => j >= 0)
                  .pop();
                fields.splice(lastOfStep === undefined ? fields.length : lastOfStep + 1, 0, f);
              } else fields[editing.index] = f;
              return { ...x, fields };
            });
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SettingsPanel({
  def,
  canEdit,
  update,
}: {
  def: AdmissionFormDef;
  canEdit: boolean;
  update: (fn: (d: AdmissionFormDef) => AdmissionFormDef) => void;
}) {
  const s = def.settings;
  const set = (patch: Partial<AdmissionFormDef['settings']>) =>
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  return (
    <div className="ep-fb__settings">
      <label className="ep-field ep-fb__wide">
        <span className="ep-field__label">Heading on the form</span>
        <input
          className="ep-input"
          disabled={!canEdit}
          value={s.title ?? ''}
          maxLength={200}
          onChange={(e) => set({ title: e.target.value || undefined })}
        />
      </label>
      <label className="ep-field ep-fb__wide">
        <span className="ep-field__label">Notice shown above the form</span>
        <textarea
          className="ep-input"
          rows={2}
          disabled={!canEdit}
          value={s.notice ?? ''}
          onChange={(e) => set({ notice: e.target.value || undefined })}
        />
      </label>
      <label className="ep-field ep-fb__wide">
        <span className="ep-field__label">
          Declaration (shown before submit and on the form PDF)
        </span>
        <textarea
          className="ep-input"
          rows={5}
          disabled={!canEdit}
          value={s.declaration ?? ''}
          onChange={(e) => set({ declaration: e.target.value || undefined })}
        />
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Age as on</span>
        <input
          className="ep-input"
          type="date"
          disabled={!canEdit}
          value={s.ageAsOn ?? ''}
          onChange={(e) => set({ ageAsOn: e.target.value || undefined })}
        />
        <span className="ep-field__help">
          Used by "Age as on" fields. The session can also set it per class.
        </span>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Date of birth from</span>
        <input
          className="ep-input"
          type="date"
          disabled={!canEdit}
          value={s.dobFrom ?? ''}
          onChange={(e) => set({ dobFrom: e.target.value || undefined })}
        />
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Date of birth to</span>
        <input
          className="ep-input"
          type="date"
          disabled={!canEdit}
          value={s.dobTo ?? ''}
          onChange={(e) => set({ dobTo: e.target.value || undefined })}
        />
      </label>
      <label className="ep-field">
        <span className="ep-field__label">PIN codes must start with</span>
        <input
          className="ep-input"
          disabled={!canEdit}
          value={(s.pincodePrefixes ?? []).join(', ')}
          placeholder="e.g. 110, 122, 121 (empty = any)"
          onChange={(e) =>
            set({
              pincodePrefixes: e.target.value.split(/[,\s]+/).filter((x) => /^\d{1,6}$/.test(x)),
            })
          }
        />
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Alumni pass-out year must be before</span>
        <input
          className="ep-input"
          inputMode="numeric"
          disabled={!canEdit}
          value={s.passOutBefore ?? ''}
          maxLength={4}
          onChange={(e) =>
            set({
              passOutBefore: /^\d{4}$/.test(e.target.value) ? Number(e.target.value) : undefined,
            })
          }
        />
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Largest upload (MB)</span>
        <input
          className="ep-input"
          inputMode="numeric"
          disabled={!canEdit}
          value={s.maxFileMb ?? 10}
          maxLength={2}
          onChange={(e) =>
            set({ maxFileMb: Math.min(20, Math.max(1, Number(e.target.value) || 10)) })
          }
        />
      </label>
      <label className="ep-check ep-fb__wide">
        <input
          type="checkbox"
          className="ep-check__input"
          disabled={!canEdit}
          checked={s.upperCase ?? false}
          onChange={(e) => set({ upperCase: e.target.checked })}
        />
        <span className="ep-check__box" aria-hidden="true" />
        <span className="ep-check__text">
          Type answers in CAPITALS (emails stay in small letters)
        </span>
      </label>
    </div>
  );
}

function FieldEditor({
  initial,
  isNew,
  def,
  meta,
  onClose,
  onSave,
}: {
  initial: AdmissionField;
  isNew: boolean;
  def: AdmissionFormDef;
  meta: FormMeta;
  onClose: () => void;
  onSave: (f: AdmissionField) => void;
}) {
  const [f, setF] = useState<AdmissionField>(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<AdmissionField>) => setF((x) => ({ ...x, ...patch }));
  const others = def.fields.filter((x) => x.key !== initial.key);
  const optionMode = f.list ? 'list' : f.source ? 'source' : f.options?.length ? 'typed' : 'list';
  const needsOptions = ['select', 'radio', 'checkbox'].includes(f.type);
  const mapCandidates = meta.studentFields;
  const mapped = mapCandidates.find((s) => s.key === f.maps);

  // the key made from the label: the same label on another tab (Father / Mother) gets the tab's name
  // in front, then a number, so it never clashes
  const autoKey = () => {
    const base = slug(f.label || 'field');
    const taken = (k: string) => others.some((x) => x.key === k);
    if (!taken(base)) return base;
    const tab = def.steps.find((st) => st.key === f.step);
    const withTab = slug(`${tab?.title ?? f.step} ${f.label}`).slice(0, 40);
    if (!taken(withTab)) return withTab;
    for (let n = 2; ; n += 1) {
      const k = `${withTab.slice(0, 36)}_${String(n)}`;
      if (!taken(k)) return k;
    }
  };
  const stateFields = def.fields.filter(
    (x) => x.key !== initial.key && (x.source === 'states' || x.list === 'State'),
  );
  // the state field on the same tab, if there is just one (as the fill screens assume)
  const sameTab = stateFields.filter((x) => x.step === f.step);
  const defaultState = sameTab.length === 1 ? sameTab[0]!.key : undefined;
  const finish = () => {
    const key = f.key || autoKey();
    if (!f.label.trim()) return setErr('Give the field a label');
    if (others.some((x) => x.key === key))
      return setErr(
        `Another field already uses the key ${key}: type another key, or leave it empty`,
      );
    if (needsOptions && !f.list && !f.source && !f.options?.length)
      return setErr('Choose a list, a master or type the options');
    if (
      mapped?.list &&
      needsOptions &&
      f.list !== mapped.list &&
      !(f.source && ['cities', 'states', 'countries'].includes(f.source))
    )
      return setErr(
        `This goes to ${mapped.label}, which uses the ${mapped.list} list: pick that list`,
      );
    // a city list follows the form's only state field unless told otherwise
    const dependsOn = f.source === 'cities' ? (f.dependsOn ?? defaultState) : undefined;
    onSave({ ...f, key, label: f.label.trim(), dependsOn });
  };

  return (
    <Drawer
      open
      width="lg"
      title={isNew ? 'Add a field' : `Field: ${initial.label}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ep-btn ep-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ep-btn ep-btn--primary" onClick={finish}>
            {isNew ? 'Add field' : 'Keep changes'}
          </button>
        </>
      }
    >
      <div className="ep-fb__editor">
        {err ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {err}
          </p>
        ) : null}
        <label className="ep-field ep-fb__wide">
          <span className="ep-field__label">Label *</span>
          <input
            className="ep-input"
            value={f.label}
            maxLength={400}
            onChange={(e) => set({ label: e.target.value })}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Type</span>
          <select
            className="ep-select"
            value={f.type}
            onChange={(e) => set({ type: e.target.value as AdmissionFieldType })}
          >
            {ADMISSION_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Tab</span>
          <select
            className="ep-select"
            value={f.step}
            onChange={(e) => set({ step: e.target.value })}
          >
            {def.steps.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Key (for rules and reports)</span>
          <input
            className="ep-input"
            value={f.key}
            placeholder={autoKey()}
            maxLength={40}
            disabled={!isNew}
            onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
          />
          <span className="ep-field__help">
            {isNew
              ? `Left empty: ${autoKey()} (made from the label; the tab's name is added when another tab uses the same label).`
              : 'A key cannot change once answers exist.'}
          </span>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Width</span>
          <select
            className="ep-select"
            value={f.width ?? 'half'}
            onChange={(e) => set({ width: e.target.value as 'half' | 'full' })}
          >
            <option value="half">Half (two per row)</option>
            <option value="full">Full row</option>
          </select>
        </label>
        {!['heading', 'note', 'age'].includes(f.type) ? (
          <label className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={Boolean(f.required)}
              onChange={(e) => set({ required: e.target.checked })}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">Required</span>
          </label>
        ) : null}
        <label className="ep-field ep-fb__wide">
          <span className="ep-field__label">
            {f.type === 'note' ? 'Text' : 'Help text under the field'}
          </span>
          <textarea
            className="ep-input"
            rows={f.type === 'note' ? 5 : 2}
            value={f.help ?? ''}
            onChange={(e) => set({ help: e.target.value || undefined })}
          />
        </label>

        {needsOptions ? (
          <fieldset className="ep-fb__group ep-fb__wide">
            <legend>Options</legend>
            <div className="ep-fb__radios">
              {(['list', 'source', 'typed'] as const).map((m) => (
                <label key={m} className="ep-radio">
                  <input
                    type="radio"
                    className="ep-radio__input"
                    name="optmode"
                    checked={optionMode === m}
                    onChange={() =>
                      set(
                        m === 'list'
                          ? { list: meta.lists[0], source: undefined, options: undefined }
                          : m === 'source'
                            ? { source: 'classes', list: undefined, options: undefined }
                            : { options: ['Option 1'], list: undefined, source: undefined },
                      )
                    }
                  />
                  <span className="ep-radio__dot" aria-hidden="true" />
                  <span className="ep-check__text">
                    {m === 'list'
                      ? 'A school list (Profile lists)'
                      : m === 'source'
                        ? 'A master'
                        : 'Typed here'}
                  </span>
                </label>
              ))}
            </div>
            {optionMode === 'list' ? (
              <label className="ep-field">
                <span className="ep-field__label">School list</span>
                <select
                  className="ep-select"
                  value={f.list ?? ''}
                  onChange={(e) => set({ list: e.target.value })}
                >
                  {meta.lists.map((l) => (
                    <option key={l} value={l}>
                      {l} ({(meta.options[l] ?? []).length})
                    </option>
                  ))}
                </select>
                <span className="ep-field__help">
                  Values are kept in Masters → System setup → Profile lists.
                </span>
              </label>
            ) : optionMode === 'source' ? (
              <>
                <label className="ep-field">
                  <span className="ep-field__label">Master</span>
                  <select
                    className="ep-select"
                    value={f.source ?? 'classes'}
                    onChange={(e) => set({ source: e.target.value as AdmissionField['source'] })}
                  >
                    {OPTION_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {f.source === 'cities' ? (
                  <label className="ep-field">
                    <span className="ep-field__label">Cities of the state chosen in</span>
                    <select
                      className="ep-select"
                      value={f.dependsOn ?? defaultState ?? ''}
                      onChange={(e) => set({ dependsOn: e.target.value })}
                    >
                      <option value="">Any city (no state field)</option>
                      {stateFields.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label} ({def.steps.find((st) => st.key === x.step)?.title ?? x.step})
                        </option>
                      ))}
                    </select>
                    <span className="ep-field__help">
                      The family picks the state first and sees only its cities. Put the state field
                      above the city on the tab.
                    </span>
                  </label>
                ) : null}
              </>
            ) : (
              <label className="ep-field">
                <span className="ep-field__label">One option per line</span>
                <textarea
                  className="ep-input"
                  rows={5}
                  value={(f.options ?? []).join('\n')}
                  onChange={(e) =>
                    set({
                      options: e.target.value
                        .split('\n')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            )}
          </fieldset>
        ) : null}

        {['text', 'textarea'].includes(f.type) ? (
          <label className="ep-field">
            <span className="ep-field__label">Check</span>
            <select
              className="ep-select"
              value={f.preset ?? ''}
              onChange={(e) =>
                set({ preset: (e.target.value || undefined) as AdmissionField['preset'] })
              }
            >
              <option value="">None</option>
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {f.type === 'age' ? (
          <label className="ep-field">
            <span className="ep-field__label">Date of birth field</span>
            <select
              className="ep-select"
              value={f.dobField ?? ''}
              onChange={(e) => set({ dobField: e.target.value })}
            >
              <option value="">Choose…</option>
              {others
                .filter((x) => x.type === 'date')
                .map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {f.type === 'siblings' ? (
          <label className="ep-field">
            <span className="ep-field__label">Up to how many siblings</span>
            <input
              className="ep-input"
              inputMode="numeric"
              maxLength={1}
              value={f.maxSiblings ?? 3}
              onChange={(e) =>
                set({ maxSiblings: Math.min(5, Math.max(1, Number(e.target.value) || 3)) })
              }
            />
            <span className="ep-field__help">
              Admission numbers are looked up: the name and class fill in by themselves.
            </span>
          </label>
        ) : null}
        {f.type === 'subjects' || f.type === 'marks' ? (
          <label className="ep-field">
            <span className="ep-field__label">Stream field</span>
            <select
              className="ep-select"
              value={f.streamField ?? ''}
              onChange={(e) => set({ streamField: e.target.value || undefined })}
            >
              <option value="">
                {f.type === 'marks' ? 'None (one cut-off for all)' : 'Choose…'}
              </option>
              {others
                .filter((x) => x.type === 'select' || x.type === 'radio')
                .map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {f.type === 'subjects' ? (
          <SubjectSlotsEditor
            field={f}
            def={def}
            meta={meta}
            onChange={(slots) => set({ slots })}
          />
        ) : null}
        {f.type === 'marks' ? (
          <MarksEditor field={f} def={def} meta={meta} onChange={(patch) => set(patch)} />
        ) : null}
        {f.type === 'address_same' ? (
          <>
            <label className="ep-field ep-fb__wide">
              <span className="ep-field__label">Copy these fields (keys, comma separated)</span>
              <input
                className="ep-input"
                value={(f.copyFrom ?? []).join(', ')}
                onChange={(e) => set({ copyFrom: e.target.value.split(/[,\s]+/).filter(Boolean) })}
              />
            </label>
            <label className="ep-field ep-fb__wide">
              <span className="ep-field__label">Into these fields, in the same order</span>
              <input
                className="ep-input"
                value={(f.copyTo ?? []).join(', ')}
                onChange={(e) => set({ copyTo: e.target.value.split(/[,\s]+/).filter(Boolean) })}
              />
            </label>
          </>
        ) : null}
        {f.type === 'file' || f.type === 'photo' ? (
          <label className="ep-field">
            <span className="ep-field__label">On admission it goes to the student as</span>
            <select
              className="ep-select"
              value={f.docKind ?? ''}
              onChange={(e) => set({ docKind: e.target.value || undefined })}
            >
              <option value="">Kept with the application only</option>
              {meta.docKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!['heading', 'note', 'agree', 'address_same', 'age', 'file', 'photo', 'marks'].includes(
          f.type,
        ) ? (
          <fieldset className="ep-fb__group ep-fb__wide">
            <legend>Student master</legend>
            <label className="ep-field">
              <span className="ep-field__label">On admission this answer goes to</span>
              <select
                className="ep-select"
                value={f.maps ?? ''}
                onChange={(e) =>
                  set({
                    maps: e.target.value || undefined,
                    copy: e.target.value ? undefined : f.copy,
                  })
                }
              >
                <option value="">No student-master field</option>
                {mapCandidates.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({s.section})
                  </option>
                ))}
              </select>
              {mapped?.list ? (
                <span className="ep-field__help">Uses the {mapped.list} list.</span>
              ) : null}
            </label>
            {!f.maps ? (
              <label className="ep-check">
                <input
                  type="checkbox"
                  className="ep-check__input"
                  checked={Boolean(f.copy)}
                  onChange={(e) => set({ copy: e.target.checked || undefined })}
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">
                  Copy to student master as an additional field (made when the form is saved)
                </span>
              </label>
            ) : null}
          </fieldset>
        ) : null}

        <RulesEditor field={f} others={others} onChange={(rules) => set({ rules })} />
      </div>
    </Drawer>
  );
}

function RulesEditor({
  field,
  others,
  onChange,
}: {
  field: AdmissionField;
  others: AdmissionField[];
  onChange: (r: AdmissionRule[] | undefined) => void;
}) {
  const rules = field.rules ?? [];
  const put = (i: number, r: AdmissionRule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const pickable = others.filter(
    (x) => !['heading', 'note', 'file', 'photo', 'marks', 'subjects'].includes(x.type),
  );
  return (
    <fieldset className="ep-fb__group ep-fb__wide">
      <legend>Rules</legend>
      {rules.length === 0 ? (
        <p className="ep-field__help">No rules: the field always shows.</p>
      ) : null}
      {rules.map((r, i) => (
        <div key={i} className="ep-fb__rule">
          <div className="ep-fb__rulehead">
            <select
              className="ep-select"
              aria-label="What the rule does"
              value={r.action}
              onChange={(e) => put(i, { ...r, action: e.target.value as AdmissionRule['action'] })}
            >
              {(Object.keys(ACTION_LABEL) as AdmissionRule['action'][]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
            <select
              className="ep-select"
              aria-label="All or any condition"
              value={r.logic}
              onChange={(e) => put(i, { ...r, logic: e.target.value as 'all' | 'any' })}
            >
              <option value="all">all of these hold</option>
              <option value="any">any of these holds</option>
            </select>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() =>
                onChange(
                  rules.filter((_, j) => j !== i).length
                    ? rules.filter((_, j) => j !== i)
                    : undefined,
                )
              }
            >
              Remove rule
            </button>
          </div>
          {r.conditions.map((c, k) => (
            <div key={k} className="ep-fb__cond">
              <select
                className="ep-select"
                aria-label="Field"
                value={c.field}
                onChange={(e) =>
                  put(i, {
                    ...r,
                    conditions: r.conditions.map((y, m) =>
                      m === k ? { ...y, field: e.target.value } : y,
                    ),
                  })
                }
              >
                {pickable.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select
                className="ep-select"
                aria-label="Condition"
                value={c.op}
                onChange={(e) =>
                  put(i, {
                    ...r,
                    conditions: r.conditions.map((y, m) =>
                      m === k ? { ...y, op: e.target.value as typeof c.op } : y,
                    ),
                  })
                }
              >
                {RULE_OPS.map((o) => (
                  <option key={o} value={o}>
                    {OP_LABEL[o]}
                  </option>
                ))}
              </select>
              {c.op !== 'empty' && c.op !== 'not_empty' ? (
                <input
                  className="ep-input"
                  aria-label="Value"
                  value={c.value ?? ''}
                  onChange={(e) =>
                    put(i, {
                      ...r,
                      conditions: r.conditions.map((y, m) =>
                        m === k ? { ...y, value: e.target.value } : y,
                      ),
                    })
                  }
                />
              ) : null}
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label="Remove condition"
                disabled={r.conditions.length === 1}
                onClick={() => put(i, { ...r, conditions: r.conditions.filter((_, m) => m !== k) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={!pickable.length}
            onClick={() =>
              put(i, {
                ...r,
                conditions: [...r.conditions, { field: pickable[0]!.key, op: 'eq', value: '' }],
              })
            }
          >
            Add a condition
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        disabled={!pickable.length}
        onClick={() =>
          onChange([
            ...rules,
            {
              logic: 'all',
              action: 'show',
              conditions: [{ field: pickable[0]!.key, op: 'eq', value: '' }],
            },
          ])
        }
      >
        Add a rule
      </button>
    </fieldset>
  );
}

function streamValues(field: AdmissionField, def: AdmissionFormDef, meta: FormMeta): string[] {
  const s = def.fields.find((x) => x.key === field.streamField);
  if (!s) return [];
  if (s.options?.length) return s.options;
  if (s.list) return meta.options[s.list] ?? [];
  return [];
}

function SubjectSlotsEditor({
  field,
  def,
  meta,
  onChange,
}: {
  field: AdmissionField;
  def: AdmissionFormDef;
  meta: FormMeta;
  onChange: (s: NonNullable<AdmissionField['slots']>) => void;
}) {
  const slots = field.slots ?? [];
  const streams = streamValues(field, def, meta);
  return (
    <fieldset className="ep-fb__group ep-fb__wide">
      <legend>Subject slots</legend>
      <p className="ep-field__help">
        For each slot, the subjects each stream may pick (one per line). Subjects master:{' '}
        {(meta.options['@subjects'] ?? []).slice(0, 12).join(', ')}
        {(meta.options['@subjects'] ?? []).length > 12 ? '…' : ''}
      </p>
      {slots.map((s, i) => (
        <div key={i} className="ep-fb__rule">
          <div className="ep-fb__rulehead">
            <input
              className="ep-input"
              aria-label="Slot name"
              value={s.label}
              onChange={(e) =>
                onChange(slots.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
              }
            />
            <input
              className="ep-input"
              aria-label="Fixed subject (same for every stream)"
              placeholder="Fixed subject (optional)"
              value={s.fixed ?? ''}
              onChange={(e) =>
                onChange(
                  slots.map((x, j) => (j === i ? { ...x, fixed: e.target.value || undefined } : x)),
                )
              }
            />
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => onChange(slots.filter((_, j) => j !== i))}
            >
              Remove slot
            </button>
          </div>
          {!s.fixed ? (
            <div className="ep-fb__streams">
              {streams.map((st) => (
                <label key={st} className="ep-field">
                  <span className="ep-field__label">{st}</span>
                  <textarea
                    className="ep-input"
                    rows={3}
                    value={(s.byStream?.[st] ?? []).join('\n')}
                    onChange={(e) =>
                      onChange(
                        slots.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                byStream: {
                                  ...(x.byStream ?? {}),
                                  [st]: e.target.value
                                    .split('\n')
                                    .map((y) => y.trim())
                                    .filter(Boolean),
                                },
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              {!streams.length ? (
                <p className="ep-field__help">Choose the stream field first.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        onClick={() =>
          onChange([...slots, { label: `Subject ${String(slots.length + 1)}`, byStream: {} }])
        }
      >
        Add a slot
      </button>
    </fieldset>
  );
}

function MarksEditor({
  field,
  def,
  meta,
  onChange,
}: {
  field: AdmissionField;
  def: AdmissionFormDef;
  meta: FormMeta;
  onChange: (p: Partial<AdmissionField>) => void;
}) {
  const rows = field.rows ?? [];
  const cutoffs = field.cutoffs ?? [];
  const streams = streamValues(field, def, meta);
  return (
    <fieldset className="ep-fb__group ep-fb__wide">
      <legend>Marks</legend>
      <label className="ep-field">
        <span className="ep-field__label">Out of</span>
        <input
          className="ep-input"
          inputMode="numeric"
          value={field.outOf ?? 100}
          onChange={(e) => onChange({ outOf: Math.max(1, Number(e.target.value) || 100) })}
        />
      </label>
      <h4 className="ep-fb__sub">Subject rows</h4>
      {rows.map((r, i) => (
        <div key={i} className="ep-fb__cond">
          <input
            className="ep-input"
            aria-label="Row key"
            value={r.key}
            onChange={(e) =>
              onChange({
                rows: rows.map((x, j) =>
                  j === i
                    ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }
                    : x,
                ),
              })
            }
          />
          <input
            className="ep-input"
            aria-label="Subject"
            value={r.label}
            onChange={(e) =>
              onChange({
                rows: rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
              })
            }
          />
          <input
            className="ep-input"
            aria-label="Choices for the subject (a|b)"
            placeholder="Choices a|b (optional)"
            value={(r.options ?? []).join('|')}
            onChange={(e) =>
              onChange({
                rows: rows.map((x, j) =>
                  j === i
                    ? {
                        ...x,
                        options: e.target.value
                          ? e.target.value
                              .split('|')
                              .map((y) => y.trim())
                              .filter(Boolean)
                          : undefined,
                      }
                    : x,
                ),
              })
            }
          />
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => onChange({ rows: rows.filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ep-btn ep-btn--ghost ep-btn--sm"
        onClick={() =>
          onChange({ rows: [...rows, { key: `sub${String(rows.length + 1)}`, label: 'Subject' }] })
        }
      >
        Add a row
      </button>
      <h4 className="ep-fb__sub">Cut-offs (checked before Next)</h4>
      {cutoffs.map((c, i) => (
        <div key={i} className="ep-fb__rule">
          <label className="ep-field">
            <span className="ep-field__label">Streams (empty = every stream)</span>
            <select
              multiple
              className="ep-select"
              data-native
              value={c.streams}
              onChange={(e) =>
                onChange({
                  cutoffs: cutoffs.map((x, j) =>
                    j === i
                      ? { ...x, streams: [...e.target.selectedOptions].map((o) => o.value) }
                      : x,
                  ),
                })
              }
            >
              {streams.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="ep-fb__streams">
            {rows.map((r) => (
              <label key={r.key} className="ep-field">
                <span className="ep-field__label">Minimum in {r.label}</span>
                <input
                  className="ep-input"
                  inputMode="numeric"
                  value={c.mins[r.key] ?? ''}
                  onChange={(e) => {
                    const mins = { ...c.mins };
                    if (e.target.value === '') delete mins[r.key];
                    else mins[r.key] = Number(e.target.value);
                    onChange({ cutoffs: cutoffs.map((x, j) => (j === i ? { ...x, mins } : x)) });
                  }}
                />
              </label>
            ))}
            <label className="ep-field">
              <span className="ep-field__label">Aggregate % of all rows</span>
              <input
                className="ep-input"
                inputMode="numeric"
                value={c.aggregate ?? ''}
                onChange={(e) =>
                  onChange({
                    cutoffs: cutoffs.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            aggregate: e.target.value === '' ? undefined : Number(e.target.value),
                          }
                        : x,
                    ),
                  })
                }
              />
            </label>
          </div>
          <label className="ep-field">
            <span className="ep-field__label">Message when a minimum is not met</span>
            <input
              className="ep-input"
              value={c.message ?? ''}
              onChange={(e) =>
                onChange({
                  cutoffs: cutoffs.map((x, j) =>
                    j === i ? { ...x, message: e.target.value || undefined } : x,
                  ),
                })
              }
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Message when the aggregate is not met</span>
            <input
              className="ep-input"
              value={c.aggregateMessage ?? ''}
              onChange={(e) =>
                onChange({
                  cutoffs: cutoffs.map((x, j) =>
                    j === i ? { ...x, aggregateMessage: e.target.value || undefined } : x,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => onChange({ cutoffs: cutoffs.filter((_, j) => j !== i) })}
          >
            Remove cut-off
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ep-btn ep-btn--secondary ep-btn--sm"
        onClick={() => onChange({ cutoffs: [...cutoffs, { streams: [], mins: {} }] })}
      >
        Add a cut-off
      </button>
    </fieldset>
  );
}
