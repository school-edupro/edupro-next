'use client';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  applyCareer,
  removeCareerFile,
  resendCareer,
  saveCareerStep,
} from '@/app/[school]/careers/form/actions';
import {
  INPUT,
  applies,
  birthRange,
  checkEntry,
  checkField,
  dmy,
  tidy,
  type Answers,
} from '@/lib/career-checks';
import type { CareerField, CareerForm as Form, CareerMe, CareerSaved } from '@/lib/careers';

type Entry = Record<string, string> & { _k: string };
interface Step {
  id: string;
  title: string;
  help: string;
  sections?: string[];
  rows?: string[];
  activities?: boolean;
  kind?: 'docs' | 'review';
}

/** One entry of each list, by its kind. */
const ONE: Record<string, string> = {
  education: 'Qualification',
  experience: 'Job',
  training: 'Training or workshop',
  children: 'Child',
  references: 'Reference',
};
const IMAGE = /^image\/(png|jpeg|webp)$/;
const IMAGE_OR_PDF = /^(application\/pdf|image\/(png|jpeg|webp))$/;
const MAX_BYTES = 5 * 1024 * 1024;
let seq = 0;
const key = () => {
  seq += 1;
  return `e${String(seq)}`;
};

const EYE = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);
const UPLOAD = (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The answers of the form as text boxes hold them; Aadhaar and PAN on file stay masked, not filled. */
function answersOf(form: Form, me: CareerMe): Answers {
  const a: Answers = {};
  for (const f of form.fields) {
    const v = me.values[f.key];
    a[f.key] = f.sensitive || v === null || v === undefined ? '' : String(v);
  }
  // most candidates are in India: the country is set when the school's list has it
  const countries = form.places.countries.length
    ? form.places.countries
    : (form.fields.find((f) => f.key === 'present_country')?.options ?? []);
  for (const part of ['present', 'permanent'])
    if (!a[`${part}_country`] && countries.includes('India')) a[`${part}_country`] = 'India';
  return a;
}
function entriesOf(form: Form, me: CareerMe): Record<string, Entry[]> {
  const out: Record<string, Entry[]> = {};
  for (const kind of Object.keys(form.rows)) {
    const have = (me.rows[kind] ?? []).map((r) => {
      const e: Entry = { _k: key() };
      for (const [k, v] of Object.entries(r)) e[k] = v ?? '';
      return e;
    });
    // the first qualification is asked for at once
    out[kind] = have.length || kind !== 'education' ? have : [{ _k: key() }];
  }
  return out;
}

/**
 * The careers application as a step form (docs/design/34-recruitment.md): personal details, contact and
 * address, education and experience, the present job and more, photo and documents, then a review and
 * Apply. Each answer is checked as it is left (the API's rules, run in the browser) and each step is
 * saved before the next, so nothing is lost; the API's refusals come back beside the answers. The address
 * picks country → state → city from the school's lists, a city's PIN filling itself. Laid out for phones
 * first; the same on a tablet or a desktop.
 */
export function CareerForm({
  school,
  apply,
  vacancy,
  applied,
  form,
  me: first,
  problem: firstProblem,
  correct = null,
}: {
  school: string;
  apply: string;
  vacancy: { id: string; title: string; closesText: string } | null;
  applied: string | null;
  form: Form;
  me: CareerMe;
  problem: string | null;
  /** a correction the school asked for: only the parts it marked, then the application sent again */
  correct?: {
    id: string;
    number: string;
    title: string;
    remark: string;
    steps: string[];
    parts: string;
    dueText: string;
    overdue: boolean;
  } | null;
}) {
  const steps: Step[] = useMemo(() => {
    const all: Step[] = [
      {
        id: 'personal',
        title: 'About you',
        help: 'Your name and date of birth as on your certificates.',
        sections: ['personal', 'family'],
      },
      {
        id: 'contact',
        title: 'Contact and address',
        help: 'Where the school reaches you. Pick the country, then the state, then the city.',
        sections: ['contact', 'address'],
      },
      {
        id: 'education',
        title: 'Education and experience',
        help: 'Each qualification, job and training as an entry of its own, the latest first.',
        rows: ['education', 'experience', 'training'],
      },
      {
        id: 'more',
        title: 'Present job and more',
        help: 'Your present pay, when you can join, your skills and interests, your children and references.',
        sections: ['job', 'skills'],
        rows: ['children', 'references'],
        activities: true,
      },
      {
        id: 'documents',
        title: 'Photo and documents',
        help: 'Each one is saved as soon as it is uploaded.',
        kind: 'docs',
      },
      {
        id: 'review',
        title: correct ? 'Review and send again' : vacancy ? 'Review and apply' : 'Review',
        help: correct
          ? 'Check the parts you corrected, then send the application again.'
          : 'Check your answers; change any step before you apply.',
        kind: 'review',
      },
    ];
    return correct ? all.filter((s) => s.id === 'review' || correct.steps.includes(s.id)) : all;
  }, [vacancy, correct]);
  /** where a step is in this form (a correction holds only the parts marked) */
  const at = (id: string) => steps.findIndex((s) => s.id === id);
  const [me, setMe] = useState<CareerMe>(first);
  const [answers, setAnswers] = useState<Answers>(() => answersOf(form, first));
  const [typed, setTyped] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState(() => entriesOf(form, first));
  const [activities, setActivities] = useState<string[]>(first.activities);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const returning = Boolean(first.values.first_name);
  const [step, setStep] = useState(
    !correct && returning && !first.missing.length ? steps.length - 1 : 0,
  );
  const [reached, setReached] = useState(returning || correct ? steps.length - 1 : 0);
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'danger' | 'success'; text: string } | null>(
    firstProblem ? { tone: 'danger', text: firstProblem } : null,
  );
  const [summary, setSummary] = useState<Array<{ id: string; text: string }>>([]);
  const [docState, setDocState] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const cur = steps[step]!;
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(answers.dob ?? '') ? answers.dob! : null;

  // unsaved answers are not lost by closing the tab without a word
  useEffect(() => {
    if (!dirty.size) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const fieldsOf = (s: Step) =>
    form.fields.filter((f) => s.sections?.includes(f.section) && applies(f, answers));
  const masked = (f: CareerField) => f.sensitive && !typed.has(f.key) && Boolean(me.values[f.key]);
  const touch = () => setDirty((d) => new Set(d).add(step));

  const setAnswer = (k: string, v: string) => {
    setAnswers((a) => {
      const next = { ...a, [k]: v };
      // a changed country or state empties the choices under it; a city brings its PIN
      for (const part of ['present', 'permanent']) {
        if (k === `${part}_country`) {
          next[`${part}_state`] = '';
          next[`${part}_city`] = '';
        }
        if (k === `${part}_state`) next[`${part}_city`] = '';
        if (k === `${part}_city`) {
          const pin = form.places.cities.find(
            (c) => c.name === v && c.state === next[`${part}_state`],
          )?.pin;
          if (pin && !next[`${part}_pin`]) next[`${part}_pin`] = pin;
        }
      }
      if (k === 'current_basic' || k === 'current_allowance') {
        const sum = (Number(next.current_basic) || 0) + (Number(next.current_allowance) || 0);
        next.current_total = sum ? String(sum) : '';
      }
      return next;
    });
    const f = form.fields.find((x) => x.key === k);
    if (f?.sensitive) setTyped((t) => new Set(t).add(k));
    // a mistake shown goes as soon as it is put right
    if (errors[k] && f)
      setErrors((e) => {
        const left = { ...e };
        const msg = checkField(f, v, { ...answers, [k]: v }, form, false);
        if (msg) left[k] = msg;
        else delete left[k];
        return left;
      });
    touch();
  };
  const leave = (f: CareerField) =>
    setErrors((e) => {
      const msg = checkField(f, answers[f.key] ?? '', answers, form, masked(f));
      const left = { ...e };
      if (msg) left[f.key] = msg;
      else delete left[f.key];
      return left;
    });

  const setCell = (kind: string, k: string, col: string, v: string) => {
    setEntries((all) => ({
      ...all,
      [kind]: all[kind]!.map((e) => (e._k === k ? { ...e, [col]: v } : e)),
    }));
    touch();
  };

  /** The mistakes of a step, found in the browser. */
  function checkStep(s: Step): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fieldsOf(s)) {
      const msg = checkField(f, answers[f.key] ?? '', answers, form, masked(f));
      if (msg) out[f.key] = msg;
    }
    for (const kind of s.rows ?? []) {
      const def = form.rows[kind]!;
      entries[kind]!.forEach((e, i) => {
        for (const [col, msg] of Object.entries(checkEntry(kind, def.columns, e, dob, form.today)))
          out[`${kind}.${String(i)}.${col}`] = msg;
      });
      if (kind === 'education' && !entries.education!.some((e) => (e.qualification ?? '').trim()))
        out['education.0.qualification'] = 'Give at least one qualification';
    }
    return out;
  }
  const labelOf = (k: string) => {
    const f = form.fields.find((x) => x.key === k);
    if (f) return f.label;
    const [kind, i, col] = k.split('.');
    const c = form.rows[kind ?? '']?.columns.find((x) => x.key === col);
    return `${ONE[kind ?? ''] ?? kind} ${String(Number(i) + 1)}, ${c?.label ?? col}`;
  };
  const idOf = (k: string) => `cf-${k.replace(/\./g, '-')}`;
  const showSummary = (errs: Record<string, string>) => {
    setSummary(
      Object.entries(errs).map(([k, text]) => ({ id: idOf(k), text: `${labelOf(k)}: ${text}` })),
    );
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  /**
   * Goes to step `to`. Forward, the step must be complete: its mistakes stay on screen and nothing moves.
   * A changed step is saved first (going back too: what is right is kept, the rest is shown when the
   * candidate returns).
   */
  async function go(to: number) {
    setBanner(null);
    if (to === step) return;
    const backward = to < step;
    if (cur.kind) return moveTo(to);
    const errs = checkStep(cur);
    if (Object.keys(errs).length && !backward) {
      setErrors((e) => ({ ...e, ...errs }));
      return showSummary(errs);
    }
    if (!dirty.has(step)) return moveTo(to);
    // what the step holds goes to the API; entries left empty are dropped
    const values: Record<string, string | null> = {};
    for (const f of form.fields.filter((x) => cur.sections?.includes(x.section))) {
      if (!applies(f, answers)) continue;
      if (f.sensitive && !typed.has(f.key)) continue;
      const v = tidy(f.type, answers[f.key] ?? '');
      values[f.key] = v || null;
    }
    const rows: Record<string, Array<Record<string, string>>> = {};
    const sent: Record<string, number[]> = {};
    for (const kind of cur.rows ?? []) {
      rows[kind] = [];
      sent[kind] = [];
      entries[kind]!.forEach((e, i) => {
        const cells: Record<string, string> = {};
        for (const [c, v] of Object.entries(e)) if (c !== '_k') cells[c] = v;
        if (!Object.values(cells).some((v) => v.trim())) return;
        rows[kind]!.push(cells);
        sent[kind]!.push(i);
      });
    }
    setBusy('Saving…');
    const r: CareerSaved = await saveCareerStep({
      values,
      ...(cur.rows ? { rows } : {}),
      ...(cur.activities ? { activities } : {}),
    });
    setBusy(null);
    if (r.problem) {
      setBanner({ tone: 'danger', text: `Not saved. ${r.problem}` });
      return;
    }
    if (r.me) {
      const now = r.me;
      setMe(now);
      // the answers as kept (names in capitals, Aadhaar masked again)
      setAnswers((a) => {
        const next = { ...a };
        for (const k of Object.keys(values)) {
          if (r.errors[k]) continue;
          const f = form.fields.find((x) => x.key === k)!;
          const v = now.values[k];
          next[k] = f.sensitive ? '' : v === null || v === undefined ? '' : String(v);
        }
        return next;
      });
      setTyped((t) => new Set([...t].filter((k) => !(k in values) || r.errors[k])));
    }
    // the API's refusals, by the entry the candidate sees
    const mapped: Record<string, string> = {};
    for (const [k, text] of Object.entries(r.errors)) {
      const m = /^([a-z]+)\.(\d+)\.(.+)$/.exec(k);
      if (m) mapped[`${m[1]!}.${String(sent[m[1]!]?.[Number(m[2])] ?? m[2])}.${m[3]!}`] = text;
      else mapped[k] = text;
    }
    setErrors(mapped);
    setDirty((d) => {
      const n = new Set(d);
      n.delete(step);
      return n;
    });
    if (Object.keys(mapped).length && !backward) {
      setBanner({
        tone: 'danger',
        text: 'Saved, except the answers marked below: put them right and save again.',
      });
      return showSummary(mapped);
    }
    moveTo(to);
  }
  function moveTo(to: number) {
    setSummary([]);
    setStep(to);
    setReached((r) => Math.max(r, to));
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      headRef.current?.focus();
    });
  }

  async function upload(doc: Form['documents'][number], file: File | undefined) {
    if (!file) return;
    const ok = (doc.image ? IMAGE : IMAGE_OR_PDF).test(file.type);
    if (!ok)
      return setDocState((s) => ({
        ...s,
        [doc.kind]: doc.image ? 'Choose a photo: JPG, PNG or WebP' : 'Choose a PDF or a photo',
      }));
    if (file.size > MAX_BYTES)
      return setDocState((s) => ({
        ...s,
        [doc.kind]: 'The file is over 5 MB: choose a smaller one',
      }));
    setDocState((s) => ({ ...s, [doc.kind]: `Uploading ${file.name}…` }));
    const fd = new FormData();
    fd.set('kind', doc.kind);
    fd.set('file', file);
    const res = await fetch('/api/careers/upload', { method: 'POST', body: fd });
    const r = (await res
      .json()
      .catch(() => ({ ok: false, problem: 'The upload failed' }))) as CareerSaved;
    if (r.me) setMe(r.me);
    setDocState((s) => ({
      ...s,
      [doc.kind]: r.ok ? `${doc.label}: uploaded` : (r.problem ?? 'The upload failed'),
    }));
  }
  async function remove(doc: Form['documents'][number], id: string) {
    setDocState((s) => ({ ...s, [doc.kind]: 'Removing…' }));
    const r = await removeCareerFile(id);
    if (r.me) setMe(r.me);
    setDocState((s) => ({
      ...s,
      [doc.kind]: r.ok ? `${doc.label}: removed` : (r.problem ?? 'Not removed'),
    }));
  }

  // ---- drawing ---------------------------------------------------------------------------------------

  const err = (k: string) =>
    errors[k] ? (
      <span id={`${idOf(k)}-err`} className="ep-field__error">
        {errors[k]}
      </span>
    ) : null;
  const describe = (k: string, help: string | null) =>
    [errors[k] ? `${idOf(k)}-err` : null, help ? `${idOf(k)}-help` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  function placeOptions(f: CareerField): string[] | null {
    const m = /^(present|permanent)_(country|state|city)$/.exec(f.key);
    if (!m) return null;
    const [, part, what] = m;
    if (what === 'country')
      return form.places.countries.length ? form.places.countries : (f.options ?? []);
    if (what === 'state') {
      const country = answers[`${part!}_country`];
      const list = form.places.states
        .filter((s) => !country || !s.country || s.country === country)
        .map((s) => s.name);
      return list.length ? list : (f.options ?? []);
    }
    const state = answers[`${part!}_state`];
    return form.places.cities.filter((c) => c.state === state).map((c) => c.name);
  }

  function field(f: CareerField) {
    const id = idOf(f.key);
    const v = answers[f.key] ?? '';
    const spec = INPUT[f.type] ?? {};
    const isMasked = masked(f);
    let help = f.help ?? spec.hint ?? null;
    if (isMasked)
      help = `On file as ${String(me.values[f.key])}. Type a new number only to change it.`;
    const common = {
      id,
      'aria-invalid': errors[f.key] ? true : undefined,
      'aria-describedby': describe(f.key, help),
      'aria-required': f.required || undefined,
      onBlur: () => leave(f),
    };
    const label = (
      <>
        {f.label}
        {f.required ? (
          <>
            <span aria-hidden="true"> *</span>
            <span className="ep-sr-only"> (required)</span>
          </>
        ) : null}
      </>
    );
    const helpEl = help ? (
      <span id={`${id}-help`} className="ep-field__help">
        {help}
      </span>
    ) : null;
    const places = placeOptions(f);
    const city = /_city$/.test(f.key) && places !== null;
    // the school keeps no city list at all: the city is typed
    const typedCity = city && form.places.cities.length === 0;
    const options = typedCity
      ? null
      : places !== null
        ? places
        : f.type === 'list'
          ? (f.options ?? [])
          : null;
    if (options && options.length > 0 && options.length <= 3 && places === null)
      return (
        <fieldset
          key={f.key}
          className="ep-field ep-wiz__choicefield"
          aria-describedby={describe(f.key, help)}
        >
          <legend className="ep-field__label">{label}</legend>
          <div className="ep-wiz__choices">
            {options.map((o) => (
              <label key={o} className="ep-wiz__choice">
                <input
                  type="radio"
                  name={id}
                  id={o === options[0] ? id : undefined}
                  checked={v === o}
                  onChange={() => setAnswer(f.key, o)}
                  onBlur={() => leave(f)}
                />
                <span>{o}</span>
              </label>
            ))}
          </div>
          {helpEl}
          {err(f.key)}
        </fieldset>
      );
    if (options) {
      const part = f.key.split('_')[0];
      const noState = city && !answers[`${part!}_state`];
      const none = city && !noState && options.length === 0;
      return (
        <div key={f.key} className="ep-field">
          <label className="ep-field__label" htmlFor={id}>
            {label}
          </label>
          <select
            {...common}
            className="ep-select"
            value={options.some((o) => o === v) ? v : ''}
            disabled={noState || none}
            onChange={(e) => setAnswer(f.key, e.target.value)}
          >
            <option value="">
              {noState ? 'Choose the state first' : none ? 'No city in the list' : 'Choose'}
            </option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {none ? (
            <span className="ep-field__help">
              The school’s list has no city of {answers[`${part!}_state`]} yet: please contact the
              school.
            </span>
          ) : (
            helpEl
          )}
          {err(f.key)}
        </div>
      );
    }
    if (f.type === 'textarea')
      return (
        <div key={f.key} className="ep-field ep-wiz__full">
          <label className="ep-field__label" htmlFor={id}>
            {label}
          </label>
          <textarea
            {...common}
            className="ep-input"
            rows={3}
            maxLength={2000}
            value={v}
            onChange={(e) => setAnswer(f.key, e.target.value)}
          />
          {helpEl}
          {err(f.key)}
        </div>
      );
    const range = f.key === 'dob' ? birthRange(form) : null;
    const computed = f.key === 'current_total';
    return (
      <div key={f.key} className="ep-field">
        <label className="ep-field__label" htmlFor={id}>
          {label}
        </label>
        <input
          {...common}
          className="ep-input"
          type={
            f.type === 'date'
              ? 'date'
              : f.type === 'email'
                ? 'email'
                : f.type === 'mobile'
                  ? 'tel'
                  : 'text'
          }
          inputMode={spec.inputMode}
          maxLength={f.type === 'date' ? undefined : (spec.maxLength ?? 300)}
          autoComplete={
            f.key === 'email'
              ? 'email'
              : f.key === 'mobile'
                ? 'tel-national'
                : f.key === 'first_name'
                  ? 'given-name'
                  : f.key === 'last_name'
                    ? 'family-name'
                    : f.key === 'present_pin'
                      ? 'postal-code'
                      : f.key === 'present_line1'
                        ? 'address-line1'
                        : 'off'
          }
          min={range?.min ?? (f.type === 'date' ? '1940-01-01' : undefined)}
          max={range?.max ?? (f.type === 'date' ? form.today : undefined)}
          placeholder={isMasked ? String(me.values[f.key]) : undefined}
          readOnly={computed}
          value={v}
          style={f.type === 'pan' ? { textTransform: 'uppercase' } : undefined}
          onChange={(e) =>
            setAnswer(
              f.key,
              f.type === 'mobile' || f.type === 'pin' || f.type === 'digits12'
                ? e.target.value.replace(/[^\d ]/g, '')
                : e.target.value,
            )
          }
        />
        {computed ? (
          <span className="ep-field__help">Basic pay and allowances added up</span>
        ) : (
          helpEl
        )}
        {err(f.key)}
      </div>
    );
  }

  function list(kind: string) {
    const def = form.rows[kind]!;
    const items = entries[kind]!;
    const one = ONE[kind] ?? def.title;
    return (
      <section key={kind} className="ep-wiz__block" aria-labelledby={`wiz-${kind}-h`}>
        <h3 id={`wiz-${kind}-h`} className="ep-wiz__subhead">
          {def.title}
        </h3>
        {items.length === 0 ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            None added.
          </p>
        ) : null}
        {items.map((e, i) => (
          <fieldset key={e._k} className="ep-wiz__entry">
            <legend className="ep-wiz__entry-title">
              {one} {i + 1}
            </legend>
            <div className="ep-wiz__grid">
              {def.columns.map((c) => {
                const k = `${kind}.${String(i)}.${c.key}`;
                const id = idOf(k);
                const v = e[c.key] ?? '';
                const p = {
                  id,
                  'aria-invalid': errors[k] ? true : undefined,
                  'aria-describedby': errors[k] ? `${id}-err` : undefined,
                  onBlur: () =>
                    setErrors((all) => {
                      const found = checkEntry(kind, def.columns, e, dob, form.today);
                      const left = { ...all };
                      for (const col of def.columns) {
                        const kk = `${kind}.${String(i)}.${col.key}`;
                        if (found[col.key] && (col.key === c.key || all[kk]))
                          left[kk] = found[col.key]!;
                        else if (!found[col.key]) delete left[kk];
                      }
                      return left;
                    }),
                };
                return (
                  <div key={c.key} className="ep-field">
                    <label className="ep-field__label" htmlFor={id}>
                      {c.label}
                      {c.required ? <span aria-hidden="true"> *</span> : null}
                    </label>
                    {c.type === 'list' ? (
                      <select
                        {...p}
                        className="ep-select"
                        value={v}
                        onChange={(x) => setCell(kind, e._k, c.key, x.target.value)}
                      >
                        <option value="">Choose</option>
                        {(c.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...p}
                        className="ep-input"
                        type={c.type === 'date' ? 'date' : 'text'}
                        inputMode={c.type === 'year' ? 'numeric' : undefined}
                        maxLength={c.type === 'year' ? 4 : c.type === 'date' ? undefined : 300}
                        min={c.type === 'date' ? '1940-01-01' : undefined}
                        max={c.type === 'date' ? form.today : undefined}
                        placeholder={
                          c.key === 'score'
                            ? '72% or 450/600 or 8.2 CGPA'
                            : c.type === 'year'
                              ? 'YYYY'
                              : undefined
                        }
                        value={v}
                        onChange={(x) =>
                          setCell(
                            kind,
                            e._k,
                            c.key,
                            c.type === 'year' ? x.target.value.replace(/\D/g, '') : x.target.value,
                          )
                        }
                      />
                    )}
                    {err(k)}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              aria-label={`Remove ${one.toLowerCase()} ${String(i + 1)}`}
              onClick={() => {
                setEntries((all) => ({ ...all, [kind]: all[kind]!.filter((x) => x._k !== e._k) }));
                setErrors((all) =>
                  Object.fromEntries(
                    Object.entries(all).filter(([k]) => !k.startsWith(`${kind}.`)),
                  ),
                );
                touch();
              }}
            >
              Remove
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          disabled={items.length >= def.max}
          onClick={() => {
            setEntries((all) => ({ ...all, [kind]: [...all[kind]!, { _k: key() }] }));
            touch();
          }}
        >
          + Add {items.length ? 'another' : 'a'} {one.toLowerCase()}
        </button>
        {items.length >= def.max ? <span className="ep-field__help"> Up to {def.max}.</span> : null}
      </section>
    );
  }

  function docs() {
    return (
      <div className="ep-wiz__docs">
        {form.documents.map((d) => {
          const have = me.files.filter((x) => x.kind === d.kind);
          const state = docState[d.kind];
          const inputId = `cf-doc-${d.kind}`;
          return (
            <section key={d.kind} className="ep-wiz__doc" aria-labelledby={`${inputId}-h`}>
              <div className="ep-wiz__doc-head">
                <h3 id={`${inputId}-h`} className="ep-wiz__subhead">
                  {d.label}
                </h3>
                <span
                  className={`ep-badge ep-badge--${have.length ? 'success' : d.required ? 'warning' : 'neutral'}`}
                >
                  {have.length ? 'Uploaded' : d.required ? 'Needed' : 'Optional'}
                </span>
              </div>
              {have.length ? (
                <ul className="ep-wiz__thumbs">
                  {have.map((x, i) => (
                    <li key={x.id} className="ep-wiz__thumb">
                      {IMAGE.test(x.contentType) ? (
                        <img
                          src={`/api/careers/file/${x.fileId}`}
                          alt={`${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                        />
                      ) : (
                        <span className="ep-wiz__pdf" aria-hidden="true">
                          PDF
                        </span>
                      )}
                      <span className="ep-wiz__thumb-tools">
                        <a
                          href={`/api/careers/file/${x.fileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ep-filelinks__btn"
                          aria-label={`View ${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                          title={`View ${d.label}`}
                        >
                          {EYE}
                        </a>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                          onClick={() => void remove(d, x.id)}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {d.many || !have.length ? (
                <label
                  htmlFor={inputId}
                  className={`ep-wiz__drop${drag === d.kind ? ' ep-wiz__drop--over' : ''}`}
                  onDragOver={(e: DragEvent) => {
                    e.preventDefault();
                    setDrag(d.kind);
                  }}
                  onDragLeave={() => setDrag(null)}
                  onDrop={(e: DragEvent) => {
                    e.preventDefault();
                    setDrag(null);
                    void upload(d, e.dataTransfer.files[0]);
                  }}
                >
                  <input
                    id={inputId}
                    type="file"
                    className="ep-sr-only"
                    accept={
                      d.image
                        ? 'image/jpeg,image/png,image/webp'
                        : 'application/pdf,image/jpeg,image/png,image/webp'
                    }
                    onChange={(e) => {
                      void upload(d, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  {UPLOAD}
                  <span className="ep-wiz__drop-text">
                    {have.length ? 'Add another' : 'Choose a file'}{' '}
                    <span className="ep-wiz__drop-or">or drop it here</span>
                  </span>
                  <span className="ep-field__help">
                    {d.image ? 'JPG, PNG or WebP' : 'PDF, JPG, PNG or WebP'} · up to 5 MB
                  </span>
                </label>
              ) : (
                <label
                  htmlFor={inputId}
                  className="ep-btn ep-btn--secondary ep-btn--sm ep-wiz__replace"
                >
                  <input
                    id={inputId}
                    type="file"
                    className="ep-sr-only"
                    accept={
                      d.image
                        ? 'image/jpeg,image/png,image/webp'
                        : 'application/pdf,image/jpeg,image/png,image/webp'
                    }
                    onChange={(e) => {
                      void upload(d, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  Replace
                </label>
              )}
              <p className="ep-field__help" role="status" aria-live="polite" style={{ margin: 0 }}>
                {state ?? ''}
              </p>
            </section>
          );
        })}
      </div>
    );
  }

  /** Where a thing still needed is put right. */
  const stepOfMissing = (label: string) => {
    const f = form.fields.find((x) => x.label === label);
    if (f) return steps.findIndex((s) => s.sections?.includes(f.section));
    if (/qualification/i.test(label)) return at('education');
    if (form.documents.some((d) => d.label === label)) return at('documents');
    return correct ? -1 : 0;
  };
  const shown = (f: CareerField): string => {
    const v = me.values[f.key];
    if (v === null || v === undefined || v === '') return '—';
    return f.type === 'date' ? dmy(String(v)) : String(v);
  };

  function review() {
    return (
      <>
        {me.missing.length ? (
          <div className="ep-alert ep-alert--warning ep-wiz__summary" role="status">
            <div>
              <strong>Still needed before you apply:</strong>
              <ul className="ep-wiz__missing">
                {me.missing.map((m) => {
                  const i = stepOfMissing(m);
                  return (
                    <li key={m}>
                      {i < 0 ? (
                        <>
                          {m} (<a href={`/${school}/careers/form`}>in the full form</a>)
                        </>
                      ) : (
                        <button type="button" className="ep-wiz__link" onClick={() => void go(i)}>
                          {m}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}
        {steps
          .filter((s) => !s.kind)
          .map((s) => (
            <section key={s.id} className="ep-wiz__review" aria-labelledby={`rv-${s.id}`}>
              <div className="ep-wiz__review-head">
                <h3 id={`rv-${s.id}`} className="ep-wiz__subhead">
                  {s.title}
                </h3>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Change ${s.title.toLowerCase()}`}
                  onClick={() => void go(at(s.id))}
                >
                  Change
                </button>
              </div>
              {s.sections ? (
                <dl className="ep-wiz__dl">
                  {form.fields
                    // what was answered, and what is needed but not given
                    .filter(
                      (f) =>
                        s.sections!.includes(f.section) &&
                        applies(f, answers) &&
                        (f.required || shown(f) !== '—'),
                    )
                    .map((f) => (
                      <div key={f.key}>
                        <dt>{f.label}</dt>
                        <dd>{shown(f) === '—' ? 'Not given yet' : shown(f)}</dd>
                      </div>
                    ))}
                  {s.activities ? (
                    <div>
                      <dt>Interests</dt>
                      <dd>{me.activities.join(', ') || '—'}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {(s.rows ?? []).map((kind) => (
                <div key={kind} className="ep-wiz__review-list">
                  <h4 className="ep-field__label">{form.rows[kind]!.title}</h4>
                  {(me.rows[kind] ?? []).length ? (
                    <ul>
                      {(me.rows[kind] ?? []).map((r, j) => (
                        <li key={j}>
                          {form.rows[kind]!.columns.map((c) =>
                            r[c.key] ? (c.type === 'date' ? dmy(r[c.key]) : r[c.key]) : null,
                          )
                            .filter(Boolean)
                            .join(' · ')}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      None
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
        {at('documents') < 0 ? null : (
          <section className="ep-wiz__review" aria-labelledby="rv-docs">
            <div className="ep-wiz__review-head">
              <h3 id="rv-docs" className="ep-wiz__subhead">
                Photo and documents
              </h3>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label="Change photo and documents"
                onClick={() => void go(at('documents'))}
              >
                Change
              </button>
            </div>
            <ul className="ep-wiz__review-docs">
              {form.documents.map((d) => {
                const have = me.files.filter((x) => x.kind === d.kind);
                return (
                  <li key={d.kind}>
                    <span className="ep-wiz__review-doc-label">
                      {d.label}
                      <span className="ep-field__help">
                        {have.length
                          ? have.length > 1
                            ? `${String(have.length)} uploaded`
                            : 'Uploaded'
                          : d.required
                            ? 'Needed'
                            : 'Not given'}
                      </span>
                    </span>
                    {have.length ? (
                      <span className="ep-wiz__thumbs">
                        {have.map((x, i) => (
                          <a
                            key={x.id}
                            href={`/api/careers/file/${x.fileId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ep-wiz__thumb ep-wiz__thumb--link"
                            aria-label={`View ${d.label}${have.length > 1 ? ` ${String(i + 1)}` : ''}`}
                            title={`View ${d.label}`}
                          >
                            {IMAGE.test(x.contentType) ? (
                              <img src={`/api/careers/file/${x.fileId}`} alt="" />
                            ) : (
                              <span className="ep-wiz__pdf" aria-hidden="true">
                                PDF
                              </span>
                            )}
                            {EYE}
                          </a>
                        ))}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {correct ? (
          <section className="ep-wiz__apply" aria-labelledby="rv-apply">
            <h3 id="rv-apply" className="ep-wiz__subhead">
              Send application {correct.number} again
            </h3>
            <form action={resendCareer} className="ep-wiz__applyform">
              <input type="hidden" name="school" value={school} />
              <input type="hidden" name="id" value={correct.id} />
              <label className="ep-check">
                <input
                  type="checkbox"
                  name="declaration"
                  value="yes"
                  required
                  disabled={me.missing.length > 0}
                />{' '}
                I declare that the details given are true; a false statement may end my candidature
                or employment.
              </label>
              <p className="ep-field__help" style={{ margin: 0 }}>
                Only {correct.parts.toLowerCase()} change on the application; the rest stays as you
                first sent it. Please send it by {correct.dueText}.
              </p>
              <div>
                <button
                  type="submit"
                  className="ep-btn ep-btn--primary"
                  disabled={me.missing.length > 0}
                >
                  Send the corrected application
                </button>
              </div>
            </form>
          </section>
        ) : vacancy ? (
          <section className="ep-wiz__apply" aria-labelledby="rv-apply">
            <h3 id="rv-apply" className="ep-wiz__subhead">
              Apply for {vacancy.title}
            </h3>
            {applied ? (
              <p style={{ margin: 0 }}>You have applied: application {applied}.</p>
            ) : (
              <form action={applyCareer} className="ep-wiz__applyform">
                <input type="hidden" name="school" value={school} />
                <input type="hidden" name="apply" value={apply} />
                <label className="ep-check">
                  <input
                    type="checkbox"
                    name="declaration"
                    value="yes"
                    required
                    disabled={me.missing.length > 0}
                  />{' '}
                  I declare that the details given are true; a false statement may end my
                  candidature or employment.
                </label>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Applications close at {vacancy.closesText}.
                </p>
                <div>
                  <button
                    type="submit"
                    className="ep-btn ep-btn--primary"
                    disabled={me.missing.length > 0}
                  >
                    Apply now
                  </button>
                </div>
              </form>
            )}
          </section>
        ) : (
          <p className="ep-alert ep-alert--success" role="status">
            Your form is saved. <a href={`/${school}/careers`}>Choose a post to apply for</a>; the
            same form is used for every post.
          </p>
        )}
      </>
    );
  }

  let body: ReactNode;
  if (cur.kind === 'docs') body = docs();
  else if (cur.kind === 'review') body = review();
  else
    body = (
      <>
        {(cur.sections ?? []).map((sid) => {
          const fs = fieldsOf(cur).filter((f) => f.section === sid);
          if (!fs.length) return null;
          return (
            <section key={sid} className="ep-wiz__block" aria-labelledby={`wiz-${sid}-h`}>
              <h3 id={`wiz-${sid}-h`} className="ep-wiz__subhead">
                {form.sections.find((s) => s.id === sid)?.title}
              </h3>
              <div className="ep-wiz__grid">{fs.map(field)}</div>
            </section>
          );
        })}
        {(cur.rows ?? []).map(list)}
        {cur.activities ? (
          <fieldset className="ep-wiz__block ep-wiz__acts">
            <legend className="ep-wiz__subhead">Interests</legend>
            <div className="ep-wiz__choices">
              {form.activities.map((a) => (
                <label key={a} className="ep-wiz__choice">
                  <input
                    type="checkbox"
                    checked={activities.includes(a)}
                    onChange={(e) => {
                      setActivities((list) =>
                        e.target.checked ? [...list, a] : list.filter((x) => x !== a),
                      );
                      touch();
                    }}
                  />
                  <span>{a}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </>
    );

  return (
    <div className="ep-wiz">
      {correct ? (
        <div
          className={`ep-alert ep-alert--${correct.overdue ? 'danger' : 'warning'} ep-wiz__correct`}
          role="status"
        >
          <div>
            <strong>
              The school asks you to correct application {correct.number} ({correct.title})
            </strong>
            <p style={{ margin: 'var(--sp-1) 0 0' }}>“{correct.remark}”</p>
            <p style={{ margin: 'var(--sp-1) 0 0' }}>
              To correct: {correct.parts}. Send it again by {correct.dueText}
              {correct.overdue ? ' (the date has passed; send it as soon as you can)' : ''}.
            </p>
          </div>
        </div>
      ) : null}
      <nav className="ep-wiz__progress" aria-label="Steps of the application">
        <p className="ep-wiz__count">
          Step {step + 1} of {steps.length}
        </p>
        <div className="ep-wiz__bar" aria-hidden="true">
          <span style={{ width: `${String(((step + 1) / steps.length) * 100)}%` }} />
        </div>
        <ol className="ep-wiz__steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="ep-wiz__step"
                aria-current={i === step ? 'step' : undefined}
                disabled={i > reached || busy !== null}
                onClick={() => void go(i)}
              >
                <span className="ep-wiz__n" aria-hidden="true">
                  {i < step ? '✓' : i + 1}
                </span>
                <span className="ep-wiz__step-label">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="ep-card ep-wiz__card" aria-labelledby="wiz-h">
        <h2 id="wiz-h" ref={headRef} tabIndex={-1} className="ep-wiz__title">
          {cur.title}
        </h2>
        <p className="ep-field__help ep-wiz__help">{cur.help}</p>
        {banner ? (
          <div className={`ep-alert ep-alert--${banner.tone}`} role="alert">
            {banner.text}
          </div>
        ) : null}
        {summary.length ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            className="ep-alert ep-alert--danger ep-wiz__summary"
            role="alert"
          >
            <div>
              <strong>Please put these right:</strong>
              <ul>
                {summary.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(s.id)?.focus();
                      }}
                    >
                      {s.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {body}
      </section>

      <div className="ep-wiz__nav">
        {step > 0 ? (
          <button
            type="button"
            className="ep-btn ep-btn--secondary"
            disabled={busy !== null}
            onClick={() => void go(step - 1)}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={busy !== null}
            onClick={() => void go(step + 1)}
          >
            {busy ?? (cur.kind === 'docs' ? 'Continue' : 'Save and continue')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
