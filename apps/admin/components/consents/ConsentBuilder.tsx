'use client';
import { useState } from 'react';
import type { ConsentField } from '@edupro/ui';

type FieldType = ConsentField['type'];
type Rule = NonNullable<ConsentField['rule']>;
interface BField extends ConsentField {
  /** the builder's own id (a key may change while drafting) */
  uid: string;
  /** the field already has answers: its key and type stay */
  fixed?: boolean;
}
export interface ConsentAudience {
  pupils: 'all' | 'filter' | 'pupils';
  classIds: string[];
  sectionIds: string[];
  houses: string[];
  routeIds: string[];
  boarders: boolean;
  studentIds: string[];
  admissionNos: string[];
  staff: 'all' | 'filter' | 'people';
  departments: string[];
  designations: string[];
  employeeIds: string[];
  employeeCodes: string[];
}
export interface ConsentSettings {
  success?: string;
  opensAt?: string;
  closesAt?: string;
  repeat: 'once' | 'many';
  cap?: number;
  officeFill: boolean;
}
export interface ConsentDraft {
  title: string;
  description: string;
  respondents: 'family' | 'staff' | 'both';
  fields: ConsentField[];
  audience: ConsentAudience;
  settings: ConsentSettings;
}
export interface BuilderLists {
  classes: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string }>;
  houses: string[];
  routes: Array<{ id: string; name: string }>;
  departments: string[];
  designations: string[];
}

const TYPES: Array<[FieldType, string]> = [
  ['text', 'Short answer'],
  ['textarea', 'Long answer'],
  ['number', 'Number'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['date', 'Date'],
  ['time', 'Time'],
  ['radio', 'One choice (buttons)'],
  ['select', 'One choice (drop-down)'],
  ['checkbox', 'Several choices (ticks)'],
  ['yesno', 'Yes / No'],
  ['file', 'File (PDF or image)'],
  ['signature', 'Signature (drawn)'],
  ['agree', 'I agree (tick)'],
  ['heading', 'Section heading'],
  ['pagebreak', 'Page break (next step)'],
];
const SOURCES: Array<[string, string]> = [
  ['classes', 'Classes'],
  ['sections', 'Sections'],
  ['houses', 'Houses'],
  ['routes', 'Transport routes'],
  ['departments', 'Departments'],
];
const OPS: Array<[string, string]> = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['contains', 'contains'],
  ['gt', 'is more than'],
  ['lt', 'is less than'],
  ['in', 'is one of (a, b)'],
  ['empty', 'is empty'],
  ['not_empty', 'is answered'],
];
const CHOICE: FieldType[] = ['radio', 'select', 'checkbox'];
const LAYOUT: FieldType[] = ['heading', 'pagebreak'];

const keyOf = (label: string, taken: Set<string>) => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 30) || 'q';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
};
// ids the same on the server and in the browser: the first render's by position, then a counter
let seq = 0;
const uid = () => `n${(seq += 1)}`;
const lines = (s: string) =>
  s
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Ticks over a list (classes, sections, houses…) that keep the chosen values. */
function Ticks({
  legend,
  items,
  value,
  onChange,
}: {
  legend: string;
  items: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!items.length) return null;
  return (
    <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ep-field__label">{legend}</legend>
      <div
        className="ep-cf__options"
        style={{ maxHeight: '10rem', overflowY: 'auto', padding: 'var(--sp-1) 0' }}
      >
        {items.map((it) => (
          <label key={it.id} className="ep-check">
            <input
              type="checkbox"
              className="ep-check__input"
              checked={value.includes(it.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, it.id] : value.filter((x) => x !== it.id))
              }
            />
            <span className="ep-check__box" aria-hidden="true" />
            <span className="ep-check__text">{it.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The consent form builder (docs/design/28-consent-forms.md): the form's title and text, who answers
 * and who is asked, the window, repeats and cap, and the fields with their rules. Saved as JSON in
 * one hidden input; the API checks everything.
 */
export function ConsentBuilder({
  initial,
  answered,
  lists,
  action,
  submitLabel,
}: {
  initial: ConsentDraft;
  /** keys that already have answers (their key and type stay) */
  answered: string[];
  lists: BuilderLists;
  action: (fd: FormData) => void | Promise<void>;
  submitLabel: string;
}) {
  const [d, setD] = useState<ConsentDraft>(initial);
  const [fields, setFields] = useState<BField[]>(
    initial.fields.map((f, i) => ({ ...f, uid: `i${i}`, fixed: answered.includes(f.key) })),
  );
  const hasAnswers = answered.length > 0;
  const set = <K extends keyof ConsentDraft>(k: K, v: ConsentDraft[K]) => setD({ ...d, [k]: v });
  const aud = (patch: Partial<ConsentAudience>) => set('audience', { ...d.audience, ...patch });
  const st = (patch: Partial<ConsentSettings>) => set('settings', { ...d.settings, ...patch });
  const upd = (i: number, patch: Partial<BField>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = (type: FieldType) => {
    const taken = new Set(fields.map((f) => f.key));
    const label =
      type === 'heading'
        ? 'Section'
        : type === 'pagebreak'
          ? 'Page break'
          : type === 'agree'
            ? 'I agree'
            : type === 'signature'
              ? 'Signature'
              : 'Question';
    setFields([
      ...fields,
      {
        uid: uid(),
        key: keyOf(label, taken),
        label,
        type,
        required: !LAYOUT.includes(type) && type !== 'checkbox',
        options: CHOICE.includes(type) ? ['Yes', 'No'] : undefined,
      },
    ]);
  };
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setFields(next);
  };
  const payload: ConsentDraft = {
    ...d,
    fields: fields.map(({ uid: _u, fixed: _f, ...f }) => {
      const out: ConsentField = { ...f };
      if (!CHOICE.includes(f.type)) {
        delete out.options;
        delete out.source;
      } else if (f.source) delete out.options;
      if (LAYOUT.includes(f.type)) delete out.required;
      return out;
    }),
  };
  const others = (f: BField) =>
    fields.filter((x) => x.uid !== f.uid && !LAYOUT.includes(x.type) && x.type !== 'signature');

  return (
    <form action={action} className="ep-cfb">
      <input type="hidden" name="form" value={JSON.stringify(payload)} />

      <section className="ep-card" aria-labelledby="cfb-about">
        <h2 id="cfb-about" className="ep-card__title">
          1. The form
        </h2>
        <div className="ep-cfb__grid">
          <label className="ep-field" htmlFor="cfb-title">
            <span className="ep-field__label">Title *</span>
            <input
              id="cfb-title"
              className="ep-input"
              required
              minLength={2}
              maxLength={200}
              value={d.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Science City trip"
            />
          </label>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Who answers</legend>
            <div className="ep-cf__options">
              {(
                [
                  ['family', 'Families (about a pupil)'],
                  ['staff', 'Staff'],
                  ['both', 'Both'],
                ] as const
              ).map(([v, l]) => (
                <label key={v} className="ep-radio">
                  <input
                    type="radio"
                    className="ep-radio__input"
                    name="cfb-respondents"
                    disabled={hasAnswers && d.respondents !== v}
                    checked={d.respondents === v}
                    onChange={() => set('respondents', v)}
                  />
                  <span className="ep-radio__dot" aria-hidden="true" />
                  <span className="ep-check__text">{l}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="ep-field" htmlFor="cfb-desc" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="ep-field__label">Text above the questions</span>
          <textarea
            id="cfb-desc"
            className="ep-input"
            rows={4}
            maxLength={5000}
            value={d.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What the form is for, dates, what the school will do with the answers."
          />
        </label>
      </section>

      <section className="ep-card" aria-labelledby="cfb-aud">
        <h2 id="cfb-aud" className="ep-card__title">
          2. Who is asked
        </h2>
        {d.respondents !== 'staff' ? (
          <div className="ep-cfb__rule" style={{ marginBottom: 'var(--sp-3)' }}>
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Pupils (their families answer)</legend>
              <div className="ep-cf__options">
                {(
                  [
                    ['all', 'Every pupil'],
                    ['filter', 'By class, section, house, route or boarders'],
                    ['pupils', 'Pupils by admission number'],
                  ] as const
                ).map(([v, l]) => (
                  <label key={v} className="ep-radio">
                    <input
                      type="radio"
                      className="ep-radio__input"
                      name="cfb-pupils"
                      checked={d.audience.pupils === v}
                      onChange={() => aud({ pupils: v })}
                    />
                    <span className="ep-radio__dot" aria-hidden="true" />
                    <span className="ep-check__text">{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {d.audience.pupils === 'filter' ? (
              <>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Every filter you tick must hold (for example section VI-A and boarders).
                </p>
                <Ticks
                  legend="Classes"
                  items={lists.classes}
                  value={d.audience.classIds}
                  onChange={(v) => aud({ classIds: v })}
                />
                <Ticks
                  legend="Sections"
                  items={lists.sections}
                  value={d.audience.sectionIds}
                  onChange={(v) => aud({ sectionIds: v })}
                />
                <Ticks
                  legend="Houses"
                  items={lists.houses.map((h) => ({ id: h, name: h }))}
                  value={d.audience.houses}
                  onChange={(v) => aud({ houses: v })}
                />
                <Ticks
                  legend="Transport routes"
                  items={lists.routes}
                  value={d.audience.routeIds}
                  onChange={(v) => aud({ routeIds: v })}
                />
                <label className="ep-check">
                  <input
                    type="checkbox"
                    className="ep-check__input"
                    checked={d.audience.boarders}
                    onChange={(e) => aud({ boarders: e.target.checked })}
                  />
                  <span className="ep-check__box" aria-hidden="true" />
                  <span className="ep-check__text">Only boarders (staying in a hostel now)</span>
                </label>
              </>
            ) : null}
            {d.audience.pupils === 'pupils' ? (
              <label className="ep-field" htmlFor="cfb-adm">
                <span className="ep-field__label">Admission numbers</span>
                <textarea
                  id="cfb-adm"
                  className="ep-input"
                  rows={3}
                  value={d.audience.admissionNos.join('\n')}
                  onChange={(e) => aud({ admissionNos: lines(e.target.value) })}
                  placeholder="One per line, or separated by commas"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {d.respondents !== 'family' ? (
          <div className="ep-cfb__rule">
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Staff</legend>
              <div className="ep-cf__options">
                {(
                  [
                    ['all', 'Every staff member'],
                    ['filter', 'By department or designation'],
                    ['people', 'Staff by code'],
                  ] as const
                ).map(([v, l]) => (
                  <label key={v} className="ep-radio">
                    <input
                      type="radio"
                      className="ep-radio__input"
                      name="cfb-staff"
                      checked={d.audience.staff === v}
                      onChange={() => aud({ staff: v })}
                    />
                    <span className="ep-radio__dot" aria-hidden="true" />
                    <span className="ep-check__text">{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {d.audience.staff === 'filter' ? (
              <>
                <Ticks
                  legend="Departments"
                  items={lists.departments.map((x) => ({ id: x, name: x }))}
                  value={d.audience.departments}
                  onChange={(v) => aud({ departments: v })}
                />
                <Ticks
                  legend="Designations"
                  items={lists.designations.map((x) => ({ id: x, name: x }))}
                  value={d.audience.designations}
                  onChange={(v) => aud({ designations: v })}
                />
              </>
            ) : null}
            {d.audience.staff === 'people' ? (
              <label className="ep-field" htmlFor="cfb-emp">
                <span className="ep-field__label">Staff codes</span>
                <textarea
                  id="cfb-emp"
                  className="ep-input"
                  rows={3}
                  value={d.audience.employeeCodes.join('\n')}
                  onChange={(e) => aud({ employeeCodes: lines(e.target.value) })}
                  placeholder="One per line, or separated by commas"
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="ep-card" aria-labelledby="cfb-fields">
        <h2 id="cfb-fields" className="ep-card__title">
          3. Questions
        </h2>
        {hasAnswers ? (
          <p className="ep-alert ep-alert--info" role="status">
            This form has answers: questions can be added, reworded or hidden with a rule, but an
            answered question cannot be removed or change its type.
          </p>
        ) : null}
        <div className="ep-cfb">
          {fields.map((f, i) => {
            const layout = LAYOUT.includes(f.type);
            const id = `cfb-${f.uid}`;
            return (
              <div
                key={f.uid}
                className="ep-cfb__field"
                data-layout={layout ? 'true' : undefined}
                role="group"
                aria-label={`Question ${i + 1}: ${f.label}`}
              >
                <div className="ep-cfb__head">
                  <strong>
                    {i + 1}. {TYPES.find((t) => t[0] === f.type)?.[1]}
                  </strong>
                  <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${f.label} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => move(i, 1)}
                      disabled={i === fields.length - 1}
                      aria-label={`Move ${f.label} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => {
                        const taken = new Set(fields.map((x) => x.key));
                        const copy = { ...f, uid: uid(), fixed: false, key: keyOf(f.label, taken) };
                        setFields([...fields.slice(0, i + 1), copy, ...fields.slice(i + 1)]);
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      disabled={f.fixed}
                      title={f.fixed ? 'Answered: hide it with a rule instead' : undefined}
                      onClick={() => setFields(fields.filter((x) => x.uid !== f.uid))}
                    >
                      Remove
                    </button>
                  </span>
                </div>
                {f.type === 'pagebreak' ? (
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    The questions after this come on the next step.
                  </p>
                ) : (
                  <div className="ep-cfb__grid">
                    <label className="ep-field" htmlFor={`${id}-label`}>
                      <span className="ep-field__label">
                        {f.type === 'heading'
                          ? 'Heading'
                          : f.type === 'agree'
                            ? 'Statement to agree to'
                            : 'Question'}
                      </span>
                      <input
                        id={`${id}-label`}
                        className="ep-input"
                        value={f.label}
                        maxLength={300}
                        onChange={(e) => {
                          const taken = new Set(
                            fields.filter((x) => x.uid !== f.uid).map((x) => x.key),
                          );
                          const key = f.fixed ? f.key : keyOf(e.target.value, taken);
                          // a new key: the rules that look at this question follow it
                          setFields(
                            fields.map((x) =>
                              x.uid === f.uid
                                ? { ...x, label: e.target.value, key }
                                : x.rule && key !== f.key
                                  ? {
                                      ...x,
                                      rule: {
                                        ...x.rule,
                                        conditions: x.rule.conditions.map((c) =>
                                          c.field === f.key ? { ...c, field: key } : c,
                                        ),
                                      },
                                    }
                                  : x,
                            ),
                          );
                        }}
                      />
                    </label>
                    {!layout ? (
                      <label className="ep-field" htmlFor={`${id}-type`}>
                        <span className="ep-field__label">Answer type</span>
                        <select
                          id={`${id}-type`}
                          className="ep-select"
                          value={f.type}
                          disabled={f.fixed}
                          onChange={(e) => {
                            const type = e.target.value as FieldType;
                            upd(i, {
                              type,
                              options: CHOICE.includes(type)
                                ? (f.options ?? ['Yes', 'No'])
                                : undefined,
                            });
                          }}
                        >
                          {TYPES.filter((t) => !LAYOUT.includes(t[0])).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label className="ep-field" htmlFor={`${id}-help`}>
                      <span className="ep-field__label">Help text</span>
                      <input
                        id={`${id}-help`}
                        className="ep-input"
                        value={f.help ?? ''}
                        maxLength={500}
                        onChange={(e) => upd(i, { help: e.target.value || undefined })}
                      />
                    </label>
                    {['text', 'textarea', 'number', 'email', 'phone'].includes(f.type) ? (
                      <label className="ep-field" htmlFor={`${id}-ph`}>
                        <span className="ep-field__label">Example in the box</span>
                        <input
                          id={`${id}-ph`}
                          className="ep-input"
                          value={f.placeholder ?? ''}
                          maxLength={120}
                          onChange={(e) => upd(i, { placeholder: e.target.value || undefined })}
                        />
                      </label>
                    ) : null}
                    {f.type === 'number' ? (
                      <>
                        <label className="ep-field" htmlFor={`${id}-min`}>
                          <span className="ep-field__label">Least</span>
                          <input
                            id={`${id}-min`}
                            className="ep-input"
                            type="number"
                            value={f.min ?? ''}
                            onChange={(e) =>
                              upd(i, {
                                min: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="ep-field" htmlFor={`${id}-max`}>
                          <span className="ep-field__label">Most</span>
                          <input
                            id={`${id}-max`}
                            className="ep-input"
                            type="number"
                            value={f.max ?? ''}
                            onChange={(e) =>
                              upd(i, {
                                max: e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </>
                    ) : null}
                    {f.type === 'file' ? (
                      <label className="ep-field" htmlFor={`${id}-files`}>
                        <span className="ep-field__label">How many files</span>
                        <select
                          id={`${id}-files`}
                          className="ep-select"
                          value={f.maxFiles ?? 1}
                          onChange={(e) => upd(i, { maxFiles: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              Up to {n}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {CHOICE.includes(f.type) ? (
                      <label className="ep-field" htmlFor={`${id}-src`}>
                        <span className="ep-field__label">Options from</span>
                        <select
                          id={`${id}-src`}
                          className="ep-select"
                          value={f.source ?? ''}
                          onChange={(e) => upd(i, { source: e.target.value || undefined })}
                        >
                          <option value="">Typed below</option>
                          {SOURCES.map(([v, l]) => (
                            <option key={v} value={v}>
                              School list: {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                )}
                {CHOICE.includes(f.type) && !f.source ? (
                  <label className="ep-field" htmlFor={`${id}-opts`}>
                    <span className="ep-field__label">Options (one per line)</span>
                    <textarea
                      id={`${id}-opts`}
                      className="ep-input"
                      rows={3}
                      value={(f.options ?? []).join('\n')}
                      onChange={(e) =>
                        upd(i, {
                          options: e.target.value
                            .split(/\r?\n/)
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                ) : null}
                {!layout ? (
                  <div className="ep-cf__options">
                    <label className="ep-check">
                      <input
                        type="checkbox"
                        className="ep-check__input"
                        checked={Boolean(f.required)}
                        onChange={(e) => upd(i, { required: e.target.checked })}
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-check__text">An answer is needed</span>
                    </label>
                    <label className="ep-check">
                      <input
                        type="checkbox"
                        className="ep-check__input"
                        checked={Boolean(f.rule)}
                        disabled={others(f).length === 0}
                        onChange={(e) =>
                          upd(i, {
                            rule: e.target.checked
                              ? {
                                  logic: 'all',
                                  action: 'show',
                                  conditions: [{ field: others(f)[0]!.key, op: 'eq', value: '' }],
                                }
                              : undefined,
                          })
                        }
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-check__text">Depends on another answer</span>
                    </label>
                  </div>
                ) : null}
                {f.rule ? (
                  <RuleEditor
                    id={id}
                    rule={f.rule}
                    fields={others(f)}
                    onChange={(rule) => upd(i, { rule })}
                  />
                ) : null}
              </div>
            );
          })}
          <div className="ep-cfb__add">
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('text')}
            >
              ＋ Question
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('radio')}
            >
              ＋ Choice
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('yesno')}
            >
              ＋ Yes / No
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('file')}
            >
              ＋ File
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('signature')}
            >
              ＋ Signature
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => add('agree')}
            >
              ＋ I agree
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => add('heading')}
            >
              ＋ Section heading
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => add('pagebreak')}
            >
              ＋ Page break
            </button>
          </div>
        </div>
      </section>

      <section className="ep-card" aria-labelledby="cfb-when">
        <h2 id="cfb-when" className="ep-card__title">
          4. When and how often
        </h2>
        <div className="ep-cfb__grid">
          <label className="ep-field" htmlFor="cfb-opens">
            <span className="ep-field__label">Opens on</span>
            <input
              id="cfb-opens"
              className="ep-input"
              type="datetime-local"
              value={d.settings.opensAt ?? ''}
              onChange={(e) => st({ opensAt: e.target.value || undefined })}
            />
            <span className="ep-field__help">Empty: as soon as it is published.</span>
          </label>
          <label className="ep-field" htmlFor="cfb-closes">
            <span className="ep-field__label">Closes on</span>
            <input
              id="cfb-closes"
              className="ep-input"
              type="datetime-local"
              value={d.settings.closesAt ?? ''}
              onChange={(e) => st({ closesAt: e.target.value || undefined })}
            />
            <span className="ep-field__help">Empty: open until you close it.</span>
          </label>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Answers per pupil / staff member</legend>
            <div className="ep-cf__options">
              <label className="ep-radio">
                <input
                  type="radio"
                  className="ep-radio__input"
                  name="cfb-repeat"
                  checked={d.settings.repeat === 'once'}
                  onChange={() => st({ repeat: 'once' })}
                />
                <span className="ep-radio__dot" aria-hidden="true" />
                <span className="ep-check__text">Once</span>
              </label>
              <label className="ep-radio">
                <input
                  type="radio"
                  className="ep-radio__input"
                  name="cfb-repeat"
                  checked={d.settings.repeat === 'many'}
                  onChange={() => st({ repeat: 'many' })}
                />
                <span className="ep-radio__dot" aria-hidden="true" />
                <span className="ep-check__text">Several (e.g. one per guest)</span>
              </label>
            </div>
          </fieldset>
          <label className="ep-field" htmlFor="cfb-cap">
            <span className="ep-field__label">Close after this many answers</span>
            <input
              id="cfb-cap"
              className="ep-input"
              type="number"
              min={1}
              value={d.settings.cap ?? ''}
              onChange={(e) => st({ cap: e.target.value ? Number(e.target.value) : undefined })}
            />
            <span className="ep-field__help">Empty: no limit (seats, places).</span>
          </label>
        </div>
        <label className="ep-field" htmlFor="cfb-success" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="ep-field__label">Message after answering</span>
          <input
            id="cfb-success"
            className="ep-input"
            maxLength={500}
            value={d.settings.success ?? ''}
            onChange={(e) => st({ success: e.target.value || undefined })}
            placeholder="Thank you. The school will contact you if needed."
          />
        </label>
        <label className="ep-check" style={{ marginTop: 'var(--sp-3)' }}>
          <input
            type="checkbox"
            className="ep-check__input"
            checked={d.settings.officeFill}
            onChange={(e) => st({ officeFill: e.target.checked })}
          />
          <span className="ep-check__box" aria-hidden="true" />
          <span className="ep-check__text">
            The office may fill it on behalf of a family (paper form)
          </span>
        </label>
      </section>

      <div className="ep-form-actions">
        <button type="submit" className="ep-btn ep-btn--primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function RuleEditor({
  id,
  rule,
  fields,
  onChange,
}: {
  id: string;
  rule: Rule;
  fields: BField[];
  onChange: (r: Rule) => void;
}) {
  const cond = (i: number, patch: Partial<Rule['conditions'][number]>) =>
    onChange({
      ...rule,
      conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  return (
    <div className="ep-cfb__rule">
      <div className="ep-cfb__grid">
        <label className="ep-field" htmlFor={`${id}-act`}>
          <span className="ep-field__label">Then</span>
          <select
            id={`${id}-act`}
            className="ep-select"
            value={rule.action}
            onChange={(e) => onChange({ ...rule, action: e.target.value as Rule['action'] })}
          >
            <option value="show">show this question</option>
            <option value="hide">hide this question</option>
            <option value="require">make this question needed</option>
          </select>
        </label>
        <label className="ep-field" htmlFor={`${id}-logic`}>
          <span className="ep-field__label">When</span>
          <select
            id={`${id}-logic`}
            className="ep-select"
            value={rule.logic}
            onChange={(e) => onChange({ ...rule, logic: e.target.value as Rule['logic'] })}
          >
            <option value="all">all of these hold</option>
            <option value="any">any of these holds</option>
          </select>
        </label>
      </div>
      {rule.conditions.map((c, i) => {
        const src = fields.find((f) => f.key === c.field);
        const opts =
          src?.type === 'yesno' ? ['true', 'false'] : src?.source ? [] : (src?.options ?? []);
        return (
          <div key={i} className="ep-cfb__cond">
            <label className="ep-field" htmlFor={`${id}-c${i}-f`}>
              <span className="ep-field__label">Answer to</span>
              <select
                id={`${id}-c${i}-f`}
                className="ep-select"
                value={c.field}
                onChange={(e) => cond(i, { field: e.target.value })}
              >
                {fields.map((f) => (
                  <option key={f.uid} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor={`${id}-c${i}-o`}>
              <span className="ep-field__label">Test</span>
              <select
                id={`${id}-c${i}-o`}
                className="ep-select"
                value={c.op}
                onChange={(e) => cond(i, { op: e.target.value })}
              >
                {OPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {c.op === 'empty' || c.op === 'not_empty' ? (
              <span />
            ) : opts.length ? (
              <label className="ep-field" htmlFor={`${id}-c${i}-v`}>
                <span className="ep-field__label">Value</span>
                <select
                  id={`${id}-c${i}-v`}
                  className="ep-select"
                  value={c.value ?? ''}
                  onChange={(e) => cond(i, { value: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {opts.map((o) => (
                    <option key={o} value={o}>
                      {o === 'true' ? 'Yes' : o === 'false' ? 'No' : o}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="ep-field" htmlFor={`${id}-c${i}-v`}>
                <span className="ep-field__label">Value</span>
                <input
                  id={`${id}-c${i}-v`}
                  className="ep-input"
                  value={c.value ?? ''}
                  maxLength={200}
                  onChange={(e) => cond(i, { value: e.target.value })}
                />
              </label>
            )}
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={rule.conditions.length === 1}
              onClick={() =>
                onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })
              }
            >
              Remove
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          disabled={rule.conditions.length >= 10}
          onClick={() =>
            onChange({
              ...rule,
              conditions: [...rule.conditions, { field: fields[0]!.key, op: 'eq', value: '' }],
            })
          }
        >
          ＋ Another condition
        </button>
      </div>
    </div>
  );
}
