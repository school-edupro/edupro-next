'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** A consent form field as the API sends it (apps/api engagement/consent-fields.ts). */
export interface ConsentField {
  key: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'number'
    | 'email'
    | 'phone'
    | 'date'
    | 'time'
    | 'radio'
    | 'select'
    | 'checkbox'
    | 'yesno'
    | 'file'
    | 'signature'
    | 'agree'
    | 'heading'
    | 'pagebreak';
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: string[];
  source?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  maxFiles?: number;
  rule?: {
    logic: 'all' | 'any';
    action: 'show' | 'hide' | 'require';
    conditions: Array<{ field: string; op: string; value?: string }>;
  };
}
type Answer = string | number | boolean | string[] | null;
type Answers = Record<string, Answer>;

const empty = (v: Answer | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** The same rules as the server (consent-fields.ts ruleState); the server checks again. */
function holds(c: { op: string; value?: string }, v: Answer | undefined): boolean {
  const text = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
  const want = c.value ?? '';
  switch (c.op) {
    case 'eq':
      return Array.isArray(v) ? v.includes(want) : text.toLowerCase() === want.toLowerCase();
    case 'neq':
      return Array.isArray(v) ? !v.includes(want) : text.toLowerCase() !== want.toLowerCase();
    case 'contains':
      return text.toLowerCase().includes(want.toLowerCase());
    case 'gt':
      return text !== '' && Number(text) > Number(want);
    case 'lt':
      return text !== '' && Number(text) < Number(want);
    case 'in': {
      const list = want.split(',').map((x) => x.trim().toLowerCase());
      return Array.isArray(v)
        ? v.some((x) => list.includes(x.toLowerCase()))
        : list.includes(text.toLowerCase());
    }
    case 'empty':
      return empty(v);
    case 'not_empty':
      return !empty(v);
    default:
      return false;
  }
}
export function consentRuleState(f: ConsentField, answers: Answers) {
  if (!f.rule) return { shown: true, required: Boolean(f.required) };
  const results = f.rule.conditions.map((c) => holds(c, answers[c.field]));
  const match = f.rule.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
  if (f.rule.action === 'show') return { shown: match, required: match && Boolean(f.required) };
  if (f.rule.action === 'hide') return { shown: !match, required: !match && Boolean(f.required) };
  return { shown: true, required: Boolean(f.required) || match };
}

/** A box to sign in with a finger, a pen or the mouse; the drawing goes out as a PNG data URL. */
function SignaturePad({
  id,
  label,
  onChange,
}: {
  id: string;
  label: string;
  onChange: (v: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ratio = window.devicePixelRatio || 1;
    cv.width = cv.offsetWidth * ratio;
    cv.height = cv.offsetHeight * ratio;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--text-heading').trim() ||
      'black';
  }, []);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const ctx = () => canvas.current?.getContext('2d') ?? null;
  return (
    <div className="ep-cf__sign">
      <canvas
        id={id}
        ref={canvas}
        className="ep-cf__pad"
        role="img"
        aria-label={`${label}: sign in this box`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = at(e);
          ctx()?.beginPath();
          ctx()?.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = at(e);
          ctx()?.lineTo(p.x, p.y);
          ctx()?.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setSigned(true);
          onChange(canvas.current?.toDataURL('image/png') ?? null);
        }}
      />
      <div className="ep-cf__signbar">
        <span className="ep-field__help">{signed ? 'Signed' : 'Sign in the box above'}</span>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => {
            const cv = canvas.current;
            if (cv) cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
            setSigned(false);
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Fills a consent form: the fields in steps (a page break starts a new step), the rules showing,
 * hiding or requiring fields as the answers change, a signature pad, files. On submit the answers go
 * out as JSON in `answers`, each file field's files as `file__<key>`; the server checks everything again.
 */
export function ConsentFill({
  fields,
  lists = {},
  action,
  hidden = {},
  askName,
  submitLabel = 'Submit',
  intro,
}: {
  fields: ConsentField[];
  lists?: Record<string, string[]>;
  action: (fd: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
  /** ask the name of the person signing (the parent, or the office entering a paper form) */
  askName?: { label: string; defaultValue?: string };
  submitLabel?: string;
  intro?: ReactNode;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const steps = useMemo(() => {
    const out: ConsentField[][] = [[]];
    for (const f of fields) {
      if (f.type === 'pagebreak') {
        if (out[out.length - 1]!.length) out.push([]);
        continue;
      }
      out[out.length - 1]!.push(f);
    }
    return out.filter((s) => s.length);
  }, [fields]);
  const set = (key: string, v: Answer) => setAnswers((a) => ({ ...a, [key]: v }));
  const fileCount = useRef<Record<string, number>>({});

  const missing = (list: ConsentField[]) => {
    for (const f of list) {
      if (f.type === 'heading') continue;
      const { shown, required } = consentRuleState(f, answers);
      if (!shown || !required) continue;
      if (f.type === 'file') {
        if (!fileCount.current[f.key]) return f;
        continue;
      }
      if (f.type === 'agree' ? answers[f.key] !== true : empty(answers[f.key])) return f;
    }
    return null;
  };

  const optionsOf = (f: ConsentField) => (f.source ? (lists[f.source] ?? []) : (f.options ?? []));

  const input = (f: ConsentField, required: boolean) => {
    const id = `cf-${f.key}`;
    const v = answers[f.key];
    // no native "required": a step that is hidden would block the submit; the checks are ours
    const common = {
      id,
      'aria-required': required,
      'aria-describedby': f.help ? `${id}-help` : undefined,
    };
    switch (f.type) {
      case 'textarea':
        return (
          <textarea
            {...common}
            className="ep-input"
            rows={4}
            maxLength={f.maxLength ?? 5000}
            placeholder={f.placeholder}
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            {...common}
            className="ep-input"
            type="number"
            inputMode="decimal"
            min={f.min}
            max={f.max}
            placeholder={f.placeholder}
            value={v === null || v === undefined ? '' : String(v)}
            onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))}
          />
        );
      case 'radio':
      case 'yesno': {
        const opts = f.type === 'yesno' ? ['Yes', 'No'] : optionsOf(f);
        const cur = f.type === 'yesno' ? (v === true ? 'Yes' : v === false ? 'No' : '') : v;
        return (
          <div className="ep-cf__options" role="radiogroup" aria-labelledby={`${id}-label`}>
            {opts.map((o) => (
              <label key={o} className="ep-radio">
                <input
                  type="radio"
                  className="ep-radio__input"
                  name={id}
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
      case 'select':
        return (
          <select
            {...common}
            className="ep-select"
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => set(f.key, e.target.value || null)}
          >
            <option value="">Choose…</option>
            {optionsOf(f).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'checkbox': {
        const list = Array.isArray(v) ? v : [];
        return (
          <div className="ep-cf__options" role="group" aria-labelledby={`${id}-label`}>
            {optionsOf(f).map((o) => (
              <label key={o} className="ep-check">
                <input
                  type="checkbox"
                  className="ep-check__input"
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
        return (
          <label className="ep-check ep-cf__agree">
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
      case 'file':
        return (
          <input
            {...common}
            className="ep-input"
            type="file"
            name={`file__${f.key}`}
            multiple={(f.maxFiles ?? 1) > 1}
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              fileCount.current[f.key] = e.target.files?.length ?? 0;
              set(f.key, e.target.files?.length ? `${e.target.files.length} file(s)` : null);
            }}
          />
        );
      case 'signature':
        return <SignaturePad id={id} label={f.label} onChange={(x) => set(f.key, x)} />;
      default:
        return (
          <input
            {...common}
            className="ep-input"
            type={
              f.type === 'email'
                ? 'email'
                : f.type === 'phone'
                  ? 'tel'
                  : f.type === 'date'
                    ? 'date'
                    : f.type === 'time'
                      ? 'time'
                      : 'text'
            }
            maxLength={f.maxLength ?? 500}
            placeholder={f.placeholder}
            value={typeof v === 'string' ? v : ''}
            onChange={(e) => set(f.key, e.target.value)}
          />
        );
    }
  };

  const last = step >= steps.length - 1;
  // the answers sent: file fields are filled by the server action from the uploads
  const payload = Object.fromEntries(
    Object.entries(answers).filter(([k]) => fields.find((f) => f.key === k)?.type !== 'file'),
  );

  return (
    <form
      className="ep-cf"
      action={async (fd) => {
        setBusy(true);
        try {
          await action(fd);
        } finally {
          setBusy(false);
        }
      }}
      onSubmit={(e) => {
        const m = missing(steps.flat());
        if (m) {
          e.preventDefault();
          setStep(steps.findIndex((s) => s.includes(m)));
          setProblem(`${m.label}: an answer is needed`);
        }
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="answers" value={JSON.stringify(payload)} />
      {intro}
      {steps.length > 1 ? (
        <p className="ep-cf__progress" aria-live="polite">
          Step {step + 1} of {steps.length}
        </p>
      ) : null}
      {problem ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {problem}
        </p>
      ) : null}
      {steps.map((list, i) => (
        <div key={i} className="ep-cf__step" hidden={i !== step}>
          {list.map((f) => {
            if (f.type === 'heading')
              return (
                <div key={f.key} className="ep-cf__heading">
                  <h3>{f.label}</h3>
                  {f.help ? <p className="ep-field__help">{f.help}</p> : null}
                </div>
              );
            const { shown, required } = consentRuleState(f, answers);
            if (!shown)
              return f.type === 'file' ? (
                <input key={f.key} type="hidden" name={`skip__${f.key}`} value="1" />
              ) : null;
            const group = ['radio', 'yesno', 'checkbox'].includes(f.type);
            return (
              <div key={f.key} className="ep-field ep-cf__field">
                {f.type !== 'agree' ? (
                  group ? (
                    <span className="ep-field__label" id={`cf-${f.key}-label`}>
                      {f.label}
                      {required ? <span aria-hidden="true"> *</span> : null}
                    </span>
                  ) : (
                    <label
                      className="ep-field__label"
                      htmlFor={`cf-${f.key}`}
                      id={`cf-${f.key}-label`}
                    >
                      {f.label}
                      {required ? <span aria-hidden="true"> *</span> : null}
                    </label>
                  )
                ) : null}
                {input(f, required)}
                {f.help ? (
                  <span className="ep-field__help" id={`cf-${f.key}-help`}>
                    {f.help}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      {last && askName ? (
        <div className="ep-field ep-cf__field">
          <label className="ep-field__label" htmlFor="cf-signed-name">
            {askName.label}
          </label>
          <input
            id="cf-signed-name"
            name="signedName"
            className="ep-input"
            required
            minLength={2}
            maxLength={120}
            defaultValue={askName.defaultValue}
          />
        </div>
      ) : null}
      <div className="ep-form-actions">
        {step > 0 ? (
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            onClick={() => {
              setProblem(null);
              setStep(step - 1);
            }}
          >
            Back
          </button>
        ) : null}
        {!last ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={() => {
              const m = missing(steps[step]!);
              if (m) setProblem(`${m.label}: an answer is needed`);
              else {
                setProblem(null);
                setStep(step + 1);
              }
            }}
          >
            Next
          </button>
        ) : (
          <button type="submit" className="ep-btn ep-btn--primary" disabled={busy}>
            {busy ? 'Sending…' : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}
