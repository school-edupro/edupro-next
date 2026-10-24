'use client';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ageOn,
  answerText,
  cleanAnswers,
  fieldError,
  fieldState,
  formProgress,
  LAYOUT_TYPES,
  visibleSteps,
  type AdmissionAnswer,
  type AdmissionAnswers,
  type AdmissionField,
  type AdmissionFormDef,
  type SiblingAnswer,
  linkCityStates,
} from '../admission-engine';

export interface UploadedFile {
  fileId: string;
  name?: string | null;
  contentType?: string | null;
}

export interface AdmissionFormFillProps {
  def: AdmissionFormDef;
  /** every option list by code, and masters as @classes, @subjects, @cities … */
  options: Record<string, string[]>;
  initial?: AdmissionAnswers;
  /** files already attached, by file id (name and type for the View link) */
  files?: Record<string, UploadedFile>;
  /** opens a file inline (View) */
  fileUrl?: (fileId: string) => string;
  /** builder preview: nothing is saved */
  preview?: boolean;
  /** the answers cannot change (submitted) */
  readOnly?: boolean;
  /** fields the office asked to correct: only these may change */
  onlyFields?: string[];
  /** saves a tab (called on Next); returns server errors by field */
  onSaveStep?: (
    answers: AdmissionAnswers,
    step: string,
  ) => Promise<{ ok: boolean; errors?: Record<string, string>; message?: string }>;
  onSubmit?: (
    answers: AdmissionAnswers,
  ) => Promise<{ ok: boolean; errors?: Record<string, string>; message?: string }>;
  onUpload?: (field: AdmissionField, file: File) => Promise<UploadedFile>;
  onLookupSibling?: (admissionNo: string) => Promise<{ name: string; classSection: string } | null>;
  submitLabel?: string;
  /** shown above the tabs (fee, class sought …) */
  header?: ReactNode;
}

const optionsFor = (
  f: AdmissionField,
  all: Record<string, string[]>,
  answers: Record<string, unknown> = {},
): string[] | undefined => {
  if (f.options?.length) return f.options;
  // a city list that follows a state field: that state's cities; nothing until a state is chosen
  if (f.source === 'cities' && f.dependsOn) {
    const st = answers[f.dependsOn];
    if (typeof st !== 'string' || !st) return [];
    return all[`@cities@${st}`] ?? all['@cities'] ?? [];
  }
  if (f.list) return all[f.list] ?? [];
  if (f.source) return all[`@${f.source}`] ?? [];
  return undefined;
};

const ICON = {
  check: 'M5 12l5 5L20 7',
  alert:
    'M12 8v5m0 3h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 19h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
const Svg = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The admission registration form (docs/design/39): the school's form in tabs, a progress bar, Next
 * that checks the tab (with the school's messages under each field) and saves it, Previous without
 * checks, uploads, sibling look-up, subjects by stream, marks with cut-offs, a review of everything,
 * then the declaration and submit. The same rules run on the server.
 */
export function AdmissionFormFill({
  def: defIn,
  options,
  initial,
  files: initialFiles,
  fileUrl,
  preview,
  readOnly,
  onlyFields,
  onSaveStep,
  onSubmit,
  onUpload,
  onLookupSibling,
  submitLabel = 'I agree & submit',
  header,
}: AdmissionFormFillProps) {
  // each city list follows its state (the builder's preview gets the raw form)
  const def = useMemo(() => linkCityStates(defIn), [defIn]);
  const [answers, setAnswers] = useState<AdmissionAnswers>(() => ({ ...(initial ?? {}) }));
  const [files, setFiles] = useState<Record<string, UploadedFile>>(initialFiles ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touchedSteps, setTouchedSteps] = useState<Set<string>>(new Set());
  const [stepKey, setStepKey] = useState<string>(() => def.steps[0]?.key ?? '');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const steps = useMemo(() => visibleSteps(def, answers), [def, answers]);
  const idx = Math.max(
    0,
    steps.findIndex((s) => s.key === stepKey),
  );
  const step = steps[idx];
  const progress = formProgress(def, answers);
  const editable = (f: AdmissionField) =>
    !readOnly && !f.readOnly && !f.fixedValue && (!onlyFields || onlyFields.includes(f.key));

  const set = (key: string, v: AdmissionAnswer) => {
    setAnswers((a) => {
      const next = { ...a, [key]: v };
      // a city that is not in the newly chosen state's list is cleared
      for (const f of def.fields)
        if (f.dependsOn === key && typeof next[f.key] === 'string' && next[f.key]) {
          const list = optionsFor(f, options, next) ?? [];
          if (!list.includes(next[f.key] as string)) next[f.key] = null;
        }
      // "same as" boxes copy as the source changes
      for (const f of def.fields)
        if (f.type === 'address_same' && next[f.key] === true)
          (f.copyFrom ?? []).forEach((from, i) => {
            const to = f.copyTo?.[i];
            if (to) next[to] = next[from];
          });
      return next;
    });
    setErrors((e) => {
      if (!e[key]) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
  };

  const stepErrors = (key: string) => {
    const out: Record<string, string> = {};
    for (const f of def.fields) {
      if (f.step !== key) continue;
      // an answer the family cannot change here (a correction asks for others) is the school's to check
      if (onlyFields && !onlyFields.includes(f.key)) continue;
      // an ID number already saved comes back masked (XXXX-XXXX-1234): the server keeps the real one
      const v = answers[f.key];
      if (typeof v === 'string' && /^X{4}-X{4}-\w{4}$/.test(v)) continue;
      const e = fieldError(f, answers, def.settings, optionsFor(f, options, answers));
      if (e) out[f.key] = e;
    }
    return out;
  };
  const stepHasErrors = (key: string) => Object.keys(stepErrors(key)).length > 0;

  const go = async (dir: 1 | -1) => {
    setMessage(null);
    if (dir === -1) {
      setStepKey(steps[idx - 1]?.key ?? stepKey);
      return;
    }
    if (!step) return;
    const errs = readOnly ? {} : stepErrors(step.key);
    setTouchedSteps((t) => new Set(t).add(step.key));
    if (Object.keys(errs).length) {
      setErrors(errs);
      setMessage({ tone: 'danger', text: 'Please correct the fields marked below.' });
      return;
    }
    if (!preview && !readOnly && onSaveStep) {
      setBusy(true);
      const r = await onSaveStep(cleanAnswers(def, answers), step.key).finally(() =>
        setBusy(false),
      );
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setMessage({ tone: 'danger', text: r.message ?? 'Could not save; please try again.' });
        return;
      }
    }
    setErrors({});
    if (idx >= steps.length - 1) setReviewing(true);
    else setStepKey(steps[idx + 1]!.key);
  };

  const submit = async () => {
    const all: Record<string, string> = {};
    for (const s of steps) Object.assign(all, stepErrors(s.key));
    if (Object.keys(all).length) {
      setErrors(all);
      setReviewing(false);
      const first = def.fields.find((f) => all[f.key]);
      if (first) setStepKey(first.step);
      setMessage({ tone: 'danger', text: 'Some fields still need an answer.' });
      return;
    }
    if (preview || !onSubmit) {
      setMessage({ tone: 'success', text: 'Preview: every check passed. Nothing was saved.' });
      return;
    }
    setBusy(true);
    const r = await onSubmit(cleanAnswers(def, answers)).finally(() => setBusy(false));
    if (!r.ok) {
      setErrors(r.errors ?? {});
      setMessage({ tone: 'danger', text: r.message ?? 'Could not submit.' });
    }
  };

  const fileList = (v: AdmissionAnswer | undefined): string[] =>
    Array.isArray(v) ? (v as string[]) : typeof v === 'string' && v ? [v] : [];

  const input = (f: AdmissionField, required: boolean) => {
    const id = `af-${f.key}`;
    const v = answers[f.key];
    const err = errors[f.key];
    const describedBy =
      [f.help ? `${id}-help` : '', err ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
    const common = {
      id,
      'aria-required': required || undefined,
      'aria-invalid': err ? true : undefined,
      'aria-describedby': describedBy,
      disabled: !editable(f),
    };
    const opts = optionsFor(f, options, answers) ?? [];
    const str = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
    const upper =
      (f.upper ?? def.settings.upperCase) && ['text', 'textarea'].includes(f.type) && !f.preset;
    switch (f.type) {
      case 'textarea':
        return (
          <textarea
            {...common}
            className="ep-input"
            rows={3}
            maxLength={f.maxLength ?? 1000}
            placeholder={f.placeholder}
            style={upper ? { textTransform: 'uppercase' } : undefined}
            value={str}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
      case 'select':
        return (
          <select
            {...common}
            className="ep-select"
            value={f.fixedValue ?? str}
            onChange={(e) => set(f.key, e.target.value || null)}
          >
            <option value="">
              {f.dependsOn && !answers[f.dependsOn]
                ? `Choose the ${def.fields.find((x) => x.key === f.dependsOn)?.label ?? 'state'} first`
                : 'Choose…'}
            </option>
            {f.fixedValue && !opts.includes(f.fixedValue) ? <option>{f.fixedValue}</option> : null}
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'radio':
      case 'yesno': {
        const list = f.type === 'yesno' ? ['Yes', 'No'] : opts;
        const cur = f.type === 'yesno' ? (v === true ? 'Yes' : v === false ? 'No' : '') : str;
        return (
          <div
            className="ep-af__options"
            role="radiogroup"
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
          >
            {list.map((o) => (
              <label key={o} className="ep-radio">
                <input
                  type="radio"
                  className="ep-radio__input"
                  name={id}
                  disabled={!editable(f)}
                  checked={cur === o}
                  onChange={() => set(f.key, f.type === 'yesno' ? o === 'Yes' : o)}
                />
                <span className="ep-radio__dot" aria-hidden="true" />
                <span className="ep-check__text">{o}</span>
              </label>
            ))}
          </div>
        );
      }
      case 'checkbox': {
        const list = Array.isArray(v) ? (v as string[]) : [];
        return (
          <div className="ep-af__options" role="group" aria-labelledby={`${id}-label`}>
            {opts.map((o) => (
              <label key={o} className="ep-check">
                <input
                  type="checkbox"
                  className="ep-check__input"
                  disabled={!editable(f)}
                  checked={list.includes(o)}
                  onChange={(e) =>
                    set(f.key, e.target.checked ? [...list, o] : list.filter((x) => x !== o))
                  }
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">{o}</span>
              </label>
            ))}
          </div>
        );
      }
      case 'agree':
      case 'address_same':
        return (
          <label className="ep-check ep-af__agree">
            <input
              {...common}
              type="checkbox"
              className="ep-check__input"
              checked={v === true}
              onChange={(e) => set(f.key, e.target.checked)}
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{f.label}</span>
          </label>
        );
      case 'age': {
        const dob = f.dobField ? String(answers[f.dobField] ?? '') : '';
        const age = dob && def.settings.ageAsOn ? ageOn(dob, def.settings.ageAsOn) : null;
        return (
          <input
            id={id}
            className="ep-input"
            readOnly
            value={age?.text ?? ''}
            placeholder={
              def.settings.ageAsOn
                ? `Age as on ${def.settings.ageAsOn.split('-').reverse().join('-')}`
                : 'Worked out from the date of birth'
            }
          />
        );
      }
      case 'file':
      case 'photo': {
        const ids = fileList(v);
        const accept =
          f.accept === 'image' || f.type === 'photo'
            ? 'image/jpeg,image/png,image/webp'
            : 'application/pdf,image/jpeg,image/png,image/webp';
        const max = (def.settings.maxFileMb ?? 10) * 1024 * 1024;
        return (
          <div className="ep-af__file">
            {ids.map((fid) => (
              <span key={fid} className="ep-af__filechip">
                {fileUrl ? (
                  <a
                    href={fileUrl(fid)}
                    target="_blank"
                    rel="noreferrer"
                    className="ep-af__view"
                    aria-label={`View ${f.label}`}
                    title={files[fid]?.name ?? f.label}
                  >
                    <Svg d={ICON.eye} /> View
                  </a>
                ) : (
                  <span>Attached</span>
                )}
              </span>
            ))}
            {editable(f) && !preview ? (
              <label className="ep-filepick__btn">
                <Svg d={ICON.upload} />
                <span>
                  {uploading === f.key ? 'Uploading…' : ids.length ? 'Replace file' : 'Upload file'}
                </span>
                <input
                  className="ep-filepick__input"
                  type="file"
                  accept={accept}
                  aria-label={f.label}
                  aria-describedby={describedBy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file || !onUpload) return;
                    if (file.size > max) {
                      setErrors((x) => ({
                        ...x,
                        [f.key]: `Sorry, ${file.name} is larger than ${String(def.settings.maxFileMb ?? 10)}MB. Please upload a file up to ${String(def.settings.maxFileMb ?? 10)}MB.`,
                      }));
                      return;
                    }
                    if (!accept.split(',').includes(file.type)) {
                      setErrors((x) => ({
                        ...x,
                        [f.key]:
                          f.type === 'photo'
                            ? 'Upload a JPG, PNG or WebP photo'
                            : 'Upload a PDF, JPG, PNG or WebP file',
                      }));
                      return;
                    }
                    setUploading(f.key);
                    try {
                      const up = await onUpload(f, file);
                      setFiles((x) => ({ ...x, [up.fileId]: up }));
                      set(f.key, [up.fileId]);
                    } catch (err) {
                      setErrors((x) => ({
                        ...x,
                        [f.key]: (err as Error).message || 'The upload failed',
                      }));
                    } finally {
                      setUploading(null);
                    }
                  }}
                />
              </label>
            ) : preview ? (
              <span className="ep-field__help">
                The candidate uploads here ({f.type === 'photo' ? 'photo' : 'PDF or photo'}, up to{' '}
                {def.settings.maxFileMb ?? 10} MB)
              </span>
            ) : null}
          </div>
        );
      }
      case 'siblings': {
        const s = (v && typeof v === 'object' && 'count' in v ? v : { count: -1, list: [] }) as {
          count: number;
          list: SiblingAnswer[];
        };
        const max = f.maxSiblings ?? 3;
        const setS = (next: { count: number; list: SiblingAnswer[] }) => set(f.key, next);
        return (
          <div className="ep-af__siblings">
            <select
              {...common}
              className="ep-select ep-af__narrow"
              value={s.count < 0 ? '' : String(s.count)}
              onChange={(e) => {
                const n = e.target.value === '' ? -1 : Number(e.target.value);
                const list = [...s.list];
                while (list.length < n) list.push({ admissionNo: '' });
                if (n < 0) set(f.key, null);
                else setS({ count: n, list: list.slice(0, Math.max(n, 0)) });
              }}
            >
              <option value="">Choose…</option>
              {Array.from({ length: max + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            {Array.from({ length: Math.max(s.count, 0) }, (_, i) => {
              const sib = s.list[i] ?? { admissionNo: '' };
              return (
                <div key={i} className="ep-af__sibling">
                  <span className="ep-af__sibno">Sibling {i + 1}</span>
                  <label className="ep-field">
                    <span className="ep-field__label">Admission No (Sibling {i + 1}) *</span>
                    <input
                      className="ep-input"
                      disabled={!editable(f)}
                      value={sib.admissionNo}
                      onChange={(e) => {
                        const list = [...s.list];
                        list[i] = {
                          admissionNo: e.target.value.toUpperCase(),
                          name: null,
                          classSection: null,
                        };
                        setS({ count: s.count, list });
                      }}
                      onBlur={async () => {
                        if (!onLookupSibling || !sib.admissionNo.trim()) return;
                        const hit = await onLookupSibling(sib.admissionNo.trim());
                        const list = [...s.list];
                        list[i] = {
                          admissionNo: sib.admissionNo.trim(),
                          name: hit?.name ?? null,
                          classSection: hit?.classSection ?? null,
                        };
                        setS({ count: s.count, list });
                        if (!hit)
                          setErrors((x) => ({
                            ...x,
                            [f.key]: `Admission No (Sibling ${String(i + 1)}) was not found`,
                          }));
                      }}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Name</span>
                    <input
                      className="ep-input"
                      readOnly
                      value={sib.name ?? ''}
                      placeholder={preview ? 'Filled from the admission no.' : ''}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Class &amp; Section</span>
                    <input className="ep-input" readOnly value={sib.classSection ?? ''} />
                  </label>
                </div>
              );
            })}
          </div>
        );
      }
      case 'subjects': {
        const picked = Array.isArray(v) ? (v as string[]) : [];
        const stream = f.streamField ? String(answers[f.streamField] ?? '') : '';
        const slots = f.slots ?? [];
        return (
          <div className="ep-af__grid">
            {slots.map((slot, i) => {
              const allowed = slot.fixed ? [slot.fixed] : (slot.byStream?.[stream] ?? []);
              const cur = slot.fixed ?? picked[i] ?? '';
              return (
                <label key={i} className="ep-field">
                  <span className="ep-field__label">{slot.label} *</span>
                  <select
                    className="ep-select"
                    disabled={!editable(f) || Boolean(slot.fixed) || !stream}
                    value={cur}
                    onChange={(e) => {
                      const next = slots.map((s2, j) =>
                        s2.fixed ? s2.fixed : j === i ? e.target.value : (picked[j] ?? ''),
                      );
                      set(f.key, next);
                    }}
                  >
                    <option value="">{stream ? 'Choose…' : 'Choose the stream first'}</option>
                    {allowed.map((o) => (
                      <option
                        key={o}
                        value={o}
                        disabled={picked.some((p, j) => j !== i && p === o)}
                      >
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        );
      }
      case 'marks': {
        const m = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<
          string,
          { subject?: string; marks: number | null }
        >;
        const setRow = (key: string, patch: Partial<{ subject: string; marks: number | null }>) =>
          set(f.key, {
            ...m,
            [key]: { marks: m[key]?.marks ?? null, subject: m[key]?.subject, ...patch },
          });
        return (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={f.label}>
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Marks (out of {f.outOf ?? 100})</th>
                </tr>
              </thead>
              <tbody>
                {(f.rows ?? []).map((r) => (
                  <tr key={r.key}>
                    <th scope="row">
                      {r.options?.length ? (
                        <select
                          className="ep-select"
                          aria-label={`${r.label}: subject`}
                          disabled={!editable(f)}
                          value={m[r.key]?.subject ?? ''}
                          onChange={(e) => setRow(r.key, { subject: e.target.value })}
                        >
                          <option value="">{r.label}…</option>
                          {r.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        r.label
                      )}
                    </th>
                    <td>
                      <input
                        className="ep-input ep-af__marks"
                        inputMode="numeric"
                        aria-label={`${r.label}: marks`}
                        disabled={!editable(f)}
                        maxLength={4}
                        value={m[r.key]?.marks ?? ''}
                        onChange={(e) => {
                          const t = e.target.value.replace(/[^\d.]/g, '');
                          setRow(r.key, { marks: t === '' ? null : Number(t) });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default: {
        const numeric =
          f.type === 'mobile' ||
          f.type === 'number' ||
          ['aadhaar', 'apaar', 'udise', 'pincode', 'cbse_roll', 'year'].includes(f.preset ?? '');
        const maxLen =
          f.type === 'mobile' || f.preset === 'mobile'
            ? 10
            : f.preset === 'aadhaar' || f.preset === 'apaar'
              ? 12
              : f.preset === 'udise'
                ? 11
                : f.preset === 'pincode'
                  ? 6
                  : f.preset === 'year'
                    ? 4
                    : f.preset === 'cbse_roll'
                      ? 10
                      : (f.maxLength ?? 200);
        return (
          <input
            {...common}
            className="ep-input"
            type={f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'}
            inputMode={numeric ? 'numeric' : f.type === 'email' ? 'email' : undefined}
            maxLength={f.type === 'date' ? undefined : maxLen}
            placeholder={f.placeholder}
            style={upper ? { textTransform: 'uppercase' } : undefined}
            value={f.fixedValue ?? str}
            onChange={(e) => {
              let t = e.target.value;
              if (numeric) t = t.replace(/[^\d]/g, '');
              set(f.key, f.type === 'number' ? (t === '' ? null : Number(t)) : t);
            }}
          />
        );
      }
    }
  };

  const renderField = (f: AdmissionField) => {
    const st = fieldState(f, answers);
    if (!st.shown) return null;
    if (f.type === 'heading')
      return (
        <div key={f.key} className="ep-af__heading ep-af__full">
          <h3>{f.label}</h3>
          {f.help ? <p className="ep-field__help">{f.help}</p> : null}
        </div>
      );
    if (f.type === 'note')
      return (
        <div key={f.key} className="ep-af__note ep-af__full">
          <strong>{f.label}</strong>
          {f.help ? <p>{f.help}</p> : null}
        </div>
      );
    const id = `af-${f.key}`;
    const group = ['radio', 'yesno', 'checkbox', 'subjects', 'marks', 'siblings'].includes(f.type);
    const noLabel = f.type === 'agree' || f.type === 'address_same';
    const wide =
      f.width === 'full' ||
      ['textarea', 'siblings', 'subjects', 'marks', 'agree', 'address_same'].includes(f.type);
    return (
      <div
        key={f.key}
        className={`ep-field ep-af__field${wide ? ' ep-af__full' : ''}${errors[f.key] ? ' ep-af__field--error' : ''}`}
      >
        {noLabel ? null : group ? (
          <span className="ep-field__label" id={`${id}-label`}>
            {f.label}
            {st.required ? (
              <span className="ep-af__req" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </span>
        ) : (
          <label className="ep-field__label" htmlFor={id} id={`${id}-label`}>
            {f.label}
            {st.required ? (
              <span className="ep-af__req" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </label>
        )}
        {input(f, st.required)}
        {f.help ? (
          <span className="ep-field__help" id={`${id}-help`}>
            {f.help}
          </span>
        ) : null}
        {errors[f.key] ? (
          <span className="ep-af__error" id={`${id}-err`} role="alert">
            {errors[f.key]}
          </span>
        ) : null}
      </div>
    );
  };

  if (reviewing || (readOnly && !onlyFields))
    return (
      <div className="ep-af">
        {header}
        {!readOnly ? (
          <p className="ep-alert ep-alert--info" role="status">
            Check every answer. Use Edit to change a tab; after you submit the form cannot be
            changed.
          </p>
        ) : null}
        {steps.map((s) => (
          <section key={s.key} className="ep-af__review" aria-labelledby={`rv-${s.key}`}>
            <div className="ep-af__reviewhead">
              <h3 id={`rv-${s.key}`}>{s.title}</h3>
              {!readOnly ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => {
                    setReviewing(false);
                    setStepKey(s.key);
                  }}
                >
                  Edit
                </button>
              ) : null}
            </div>
            <dl className="ep-af__answers">
              {def.fields
                .filter(
                  (f) =>
                    f.step === s.key &&
                    !LAYOUT_TYPES.includes(f.type) &&
                    f.type !== 'agree' &&
                    f.type !== 'address_same' &&
                    fieldState(f, answers).shown,
                )
                .map((f) => {
                  const shown =
                    f.type === 'age' && f.dobField && def.settings.ageAsOn
                      ? (ageOn(String(answers[f.dobField] ?? ''), def.settings.ageAsOn)?.text ?? '')
                      : answerText(f, answers[f.key]);
                  return (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd>
                        {(f.type === 'file' || f.type === 'photo') && fileUrl
                          ? fileList(answers[f.key]).map((fid) => (
                              <a
                                key={fid}
                                href={fileUrl(fid)}
                                target="_blank"
                                rel="noreferrer"
                                className="ep-af__view"
                                aria-label={`View ${f.label}`}
                              >
                                <Svg d={ICON.eye} /> View
                              </a>
                            ))
                          : shown || <span className="ep-af__empty">Not given</span>}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </section>
        ))}
        {!readOnly ? (
          <>
            {def.settings.declaration ? (
              <div className="ep-af__note">
                <strong>Declaration</strong>
                <p>{def.settings.declaration}</p>
              </div>
            ) : null}
            {message ? (
              <p
                className={`ep-alert ep-alert--${message.tone}`}
                role={message.tone === 'danger' ? 'alert' : 'status'}
              >
                {message.text}
              </p>
            ) : null}
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                onClick={() => setReviewing(false)}
              >
                Back to the form
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? 'Submitting…' : submitLabel}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );

  return (
    <div className="ep-af">
      {header}
      <div className="ep-af__progress" aria-label="Progress status">
        <span>Progress status</span>
        <span
          className="ep-af__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label="Form filled"
        >
          <span style={{ width: `${String(progress)}%` }} />
        </span>
        <strong>{progress}%</strong>
      </div>
      <nav className="ep-af__tabs" aria-label="Form tabs">
        {steps.map((s, i) => {
          const done = touchedSteps.has(s.key) && !stepHasErrors(s.key);
          const bad = touchedSteps.has(s.key) && stepHasErrors(s.key);
          return (
            <button
              key={s.key}
              type="button"
              className="ep-af__tab"
              aria-current={s.key === step?.key ? 'step' : undefined}
              data-state={bad ? 'error' : done ? 'done' : undefined}
              onClick={() => {
                // forward only through checked tabs; back always
                if (i <= idx || readOnly || preview || touchedSteps.has(steps[i - 1]?.key ?? '')) {
                  setMessage(null);
                  setStepKey(s.key);
                }
              }}
            >
              <span className="ep-af__tabno" aria-hidden="true">
                {bad ? <Svg d={ICON.alert} /> : done ? <Svg d={ICON.check} /> : i + 1}
              </span>
              <span>{s.title}</span>
              {bad ? (
                <span className="ep-sr-only"> (needs attention)</span>
              ) : done ? (
                <span className="ep-sr-only"> (done)</span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {message ? (
        <p
          className={`ep-alert ep-alert--${message.tone}`}
          role={message.tone === 'danger' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
      {step ? (
        <section className="ep-af__step" aria-labelledby="af-step-title">
          <h2 id="af-step-title" className="ep-af__steptitle">
            {step.title}
          </h2>
          <div className="ep-af__grid">
            {def.fields.filter((f) => f.step === step.key).map(renderField)}
          </div>
        </section>
      ) : null}
      <div className="ep-form-actions">
        {idx > 0 ? (
          <button type="button" className="ep-btn ep-btn--secondary" onClick={() => void go(-1)}>
            Previous
          </button>
        ) : null}
        <button
          type="button"
          className="ep-btn ep-btn--primary"
          disabled={busy}
          onClick={() => void go(1)}
        >
          {busy ? 'Saving…' : idx >= steps.length - 1 ? 'Review' : 'Save and next'}
        </button>
      </div>
    </div>
  );
}
