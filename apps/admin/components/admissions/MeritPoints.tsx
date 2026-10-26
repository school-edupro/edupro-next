'use client';
import { Badge, RULE_OPS, type AdmissionCondition } from '@edupro/ui';
import { useId, useState, useTransition } from 'react';
import { saveSessionPoints } from '@/lib/admission-setup-actions';
import { recalculatePoints } from '@/lib/admission-scores-actions';
import type { PointRule, SessionPoints } from '@/lib/admission-setup';

const OP: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of (a|b)',
  not_in: 'is none of (a|b)',
  empty: 'is empty',
  not_empty: 'is answered',
  gt: 'is more than',
  lt: 'is less than',
  gte: 'is at least',
  lte: 'is at most',
};

/** Ready criteria on the questions of the ready forms; a school edits the points and answers. */
const STARTERS: Array<PointRule & { code: string }> = [
  // the old formula's criteria read from the school's score tables (docs/design/48)
  {
    code: 'education',
    name: "Parents' education",
    logic: 'all',
    conditions: [],
    points: 0,
    kind: 'table',
    spec: {
      table: 'qualification',
      sources: [
        { role: 'father', field: 'father_education' },
        { role: 'mother', field: 'mother_education' },
      ],
    },
  },
  {
    code: 'distance',
    name: 'Distance (locality)',
    logic: 'all',
    conditions: [],
    points: 0,
    kind: 'table',
    spec: { table: 'locality', sources: [{ role: 'child', field: 'locality' }] },
  },
  {
    code: 'alumni_table',
    name: 'Alumni parents (school list)',
    logic: 'all',
    conditions: [],
    points: 0,
    kind: 'table',
    cap: 20,
    spec: {
      table: 'alumni_school',
      school: '',
      sources: [
        { role: 'father', field: '', classField: 'father_alumni_class' },
        { role: 'mother', field: '', classField: 'mother_alumni_class' },
      ],
    },
  },
  {
    code: 'sibling_checked',
    name: 'Sibling studies here (checked)',
    logic: 'all',
    conditions: [],
    points: 26,
    kind: 'sibling',
    spec: { sources: [{ role: 'child', field: 'siblings' }] },
  },
  {
    code: 'sibling',
    name: 'Sibling studies here',
    logic: 'all',
    conditions: [{ field: 'siblings', op: 'gte', value: '1' }],
    points: 20,
  },
  {
    code: 'alumni',
    name: 'Parent is an alumnus',
    logic: 'any',
    conditions: [
      { field: 'father_alumnus', op: 'eq', value: 'Yes' },
      { field: 'mother_alumnus', op: 'eq', value: 'Yes' },
    ],
    points: 10,
  },
  {
    code: 'staff',
    name: 'Child of a staff member',
    logic: 'all',
    conditions: [{ field: 'staff_child', op: 'not_empty' }],
    points: 25,
  },
  {
    code: 'girl',
    name: 'Girl child',
    logic: 'all',
    conditions: [{ field: 'gender', op: 'eq', value: 'Female' }],
    points: 5,
  },
  {
    code: 'single_girl',
    name: 'Single girl child',
    logic: 'all',
    conditions: [
      { field: 'gender', op: 'eq', value: 'Female' },
      { field: 'siblings', op: 'eq', value: '0' },
    ],
    points: 10,
  },
  {
    code: 'single_parent',
    name: 'Single parent',
    logic: 'all',
    conditions: [{ field: 'single_parent', op: 'in', value: 'Mother Only|Father Only' }],
    points: 5,
  },
  {
    code: 'cwsn',
    name: 'Child with special needs',
    logic: 'all',
    conditions: [{ field: 'cwsn', op: 'eq', value: 'Yes' }],
    points: 5,
  },
  {
    code: 'near',
    name: 'Lives within 3 km',
    logic: 'all',
    conditions: [{ field: 'distance_km', op: 'lte', value: '3' }],
    points: 40,
  },
];

type ClassLine = SessionPoints['classes'][number];
const most = (l: PointRule[]) =>
  l.reduce((n, r) => n + Math.max(0, r.kind === 'table' ? (r.cap ?? 0) : r.points), 0);
const TABLE_NAME: Record<string, string> = {
  qualification: 'Qualifications',
  locality: 'Localities',
  alumni_school: 'Alumni schools',
};
const ROLE_NAME: Record<string, string> = { father: 'Father', mother: 'Mother', child: 'Child' };
const numOrNull = (t: string) => {
  const v = t.replace(/[^\d.]/g, '');
  return v === '' ? null : Number(v);
};

/**
 * Merit points of a session (docs/design/40, part 2): the session's criteria, and per class "the
 * session's" or its own. A criterion is conditions on the form's answers and points (negative to
 * deduct); the points are worked out on each registration (part 3).
 */
export function MeritPoints({
  sessionId,
  initial,
  canEdit: canManage,
}: {
  sessionId: string;
  initial: SessionPoints;
  canEdit: boolean;
}) {
  const [data, setData] = useState(initial);
  const [session, setSession] = useState<PointRule[]>(initial.session);
  const [max, setMax] = useState<number | null>(initial.max ?? null);
  const [classes, setClasses] = useState<ClassLine[]>(initial.classes);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canEdit = canManage && data.editable;
  const touch = () => {
    setDirty(true);
    setMsg(null);
  };

  const save = () => {
    const lists = [session, ...classes.filter((k) => k.own).map((k) => k.rules)];
    const bad = lists
      .flat()
      .find(
        (r) =>
          r.name.trim().length < 2 ||
          (r.kind !== 'table' && (!Number.isFinite(r.points) || r.points === 0)) ||
          (r.kind === 'table' &&
            (!r.spec?.table || !(r.spec.sources ?? []).some((x) => x.field || x.classField))),
      );
    if (bad) {
      setMsg({
        tone: 'danger',
        text: `Every criterion needs a name, and points other than 0 or a table with its questions${bad.name ? ` (check “${bad.name}”)` : ''}.`,
      });
      return;
    }
    start(async () => {
      const r = await saveSessionPoints(sessionId, {
        session,
        max,
        classes: classes.map((k) => ({
          classId: k.classId,
          own: k.own,
          rules: k.rules,
          max: k.max ?? null,
        })),
      });
      if (r.ok) {
        setData(r.data);
        setSession(r.data.session);
        setMax(r.data.max ?? null);
        setClasses(r.data.classes);
        setDirty(false);
        setMsg({ tone: 'success', text: 'Merit points saved.' });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  };

  const setClass = (classId: string, patch: Partial<ClassLine>) => {
    setClasses((cur) => cur.map((k) => (k.classId === classId ? { ...k, ...patch } : k)));
    touch();
  };
  const sessionForms = classes.filter((k) => !k.own && k.formId);
  const recalc = (classId?: string) =>
    start(async () => {
      const r = await recalculatePoints(sessionId, classId);
      if (r.ok)
        setMsg({
          tone: 'success',
          text: `Points worked out again for ${String(r.data.recalculated)} registration${r.data.recalculated === 1 ? '' : 's'}; ${String(r.data.changed)} changed. Those confirmed at Document check stay.`,
        });
      else setMsg({ tone: 'danger', text: r.error });
    });

  if (classes.length === 0)
    return <p className="ep-field__help">Add the classes first: points test their forms.</p>;

  return (
    <div className="ep-pts">
      <p className="ep-field__help">
        Points are added to a registration&rsquo;s merit when its form&rsquo;s answers match a
        criterion; test and interview marks are added on top. The office confirms them at Document
        check. Use a minus sign to take points away. Families see each class&rsquo;s criteria and
        points on the admission page.
      </p>
      {!data.editable ? (
        <p className="ep-alert ep-alert--warning" role="status">
          The session is closed: its merit points can no longer change.
        </p>
      ) : null}

      <section className="ep-pts__list" aria-labelledby="mp-session">
        <header className="ep-pts__head">
          <h3 id="mp-session">Points for every class</h3>
          <span className="ep-field__help">
            {session.length
              ? `${String(session.length)} criteria · up to ${String(most(session))} points`
              : 'No criteria yet'}
          </span>
          <label className="ep-field ep-pts__points">
            <span className="ep-field__label">Total out of</span>
            <input
              className="ep-input"
              inputMode="decimal"
              placeholder="No maximum"
              disabled={!canEdit}
              value={max ?? ''}
              onChange={(e) => {
                setMax(numOrNull(e.target.value));
                touch();
              }}
            />
          </label>
          {canManage && !dirty ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={pending}
              onClick={() => recalc()}
            >
              Recalculate every class
            </button>
          ) : null}
        </header>
        <RuleList
          rules={session}
          fields={data.fields}
          proofs={data.proofs ?? []}
          forms={sessionForms.map((k) => ({ id: k.formId!, className: k.className }))}
          canEdit={canEdit}
          onChange={(l) => {
            setSession(l);
            touch();
          }}
        />
      </section>

      <section className="ep-pts__list" aria-labelledby="mp-classes">
        <header className="ep-pts__head">
          <h3 id="mp-classes">Classes</h3>
          <span className="ep-field__help">
            A class can keep its own criteria instead (Nursery and IX often differ).
          </span>
        </header>
        <ul className="ep-pts__classes">
          {classes.map((k) => (
            <li key={k.classId} className="ep-pts__class">
              <div className="ep-pts__classhead">
                <strong>{k.className}</strong>
                <span className="ep-field__help">{k.formName ?? 'No form yet'}</span>
                <label className="ep-field ep-pts__mode">
                  <span className="ep-sr-only">Points of {k.className}</span>
                  <select
                    className="ep-select"
                    disabled={!canEdit}
                    value={k.own ? 'own' : 'session'}
                    onChange={(e) => {
                      const own = e.target.value === 'own';
                      // a class starting its own list starts from the session's
                      setClass(k.classId, {
                        own,
                        rules:
                          own && k.rules.length === 0 ? session.map((r) => ({ ...r })) : k.rules,
                      });
                    }}
                  >
                    <option value="session">Uses the points for every class</option>
                    <option value="own">Has its own points</option>
                  </select>
                </label>
                {k.own ? <Badge tone="info">up to {most(k.rules)} points</Badge> : null}
                {k.own ? (
                  <label className="ep-field ep-pts__points">
                    <span className="ep-field__label">Total out of</span>
                    <input
                      className="ep-input"
                      inputMode="decimal"
                      placeholder="No maximum"
                      disabled={!canEdit}
                      value={k.max ?? ''}
                      onChange={(e) => setClass(k.classId, { max: numOrNull(e.target.value) })}
                    />
                  </label>
                ) : null}
                {canManage && !dirty ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={pending}
                    onClick={() => recalc(k.classId)}
                  >
                    Recalculate {k.className}
                  </button>
                ) : null}
              </div>
              {k.own ? (
                <RuleList
                  rules={k.rules}
                  fields={data.fields}
                  proofs={data.proofs ?? []}
                  forms={k.formId ? [{ id: k.formId, className: k.className }] : []}
                  canEdit={canEdit}
                  onChange={(l) => setClass(k.classId, { rules: l })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}
      {canEdit ? (
        <div className="ep-sp__actions">
          <span className="ep-field__help">{dirty ? 'Unsaved changes' : ''}</span>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !dirty}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save merit points'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One list of criteria: name, points, conditions on form answers; ready criteria to start from. */
function RuleList({
  rules,
  fields,
  proofs,
  forms,
  canEdit,
  onChange,
}: {
  rules: PointRule[];
  fields: SessionPoints['fields'];
  proofs: Array<{ key: string; label: string }>;
  /** the forms of the classes going by this list, to warn about questions they do not ask */
  forms: Array<{ id: string; className: string }>;
  canEdit: boolean;
  onChange: (l: PointRule[]) => void;
}) {
  const valuesId = useId();
  const put = (i: number, patch: Partial<PointRule>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const putCond = (i: number, m: number, patch: Partial<AdmissionCondition>) =>
    put(i, { conditions: rules[i]!.conditions.map((c, n) => (n === m ? { ...c, ...patch } : c)) });
  const field = (key: string) => fields.find((f) => f.key === key);
  // a question the classes' forms do not all ask: the criterion cannot match there
  const missing = (r: PointRule) =>
    [
      ...r.conditions.map((c) => c.field),
      ...(r.spec?.sources ?? []).flatMap((x) => [x.field, x.classField ?? '']),
      r.spec?.proof ?? '',
    ]
      .filter(Boolean)
      .map((field) => ({ field }))
      .flatMap((c) =>
        forms
          .filter((f) => !field(c.field)?.forms.includes(f.id))
          .map((f) => `${f.className} does not ask “${field(c.field)?.label ?? c.field}”`),
      );
  const unused = STARTERS.filter((s) => !rules.some((r) => r.name === s.name));

  return (
    <div className="ep-pts__rules">
      {rules.length === 0 ? (
        <p className="ep-field__help">No criteria: every registration starts at 0 points.</p>
      ) : null}
      <ol className="ep-pts__ol">
        {rules.map((r, i) => {
          const warn = missing(r);
          return (
            <li key={i} className="ep-pts__rule">
              <div className="ep-pts__rulehead">
                <label className="ep-field ep-pts__name">
                  <span className="ep-field__label">Criterion</span>
                  <input
                    className="ep-input"
                    disabled={!canEdit}
                    maxLength={80}
                    value={r.name}
                    onChange={(e) => put(i, { name: e.target.value })}
                  />
                </label>
                <label className="ep-field ep-pts__points" style={{ minWidth: '13rem' }}>
                  <span className="ep-field__label">Kind</span>
                  <select
                    className="ep-select"
                    disabled={!canEdit}
                    value={r.kind ?? 'fixed'}
                    onChange={(e) => {
                      const kind = e.target.value as NonNullable<PointRule['kind']>;
                      put(i, {
                        kind,
                        points: kind === 'table' ? 0 : r.points || 10,
                        spec:
                          kind === 'table'
                            ? { table: 'qualification', sources: [{ role: 'father', field: '' }] }
                            : kind === 'sibling'
                              ? { sources: [{ role: 'child', field: 'siblings' }] }
                              : {},
                        conditions:
                          kind === 'fixed' && !r.conditions.length
                            ? [{ field: fields[0]?.key ?? '', op: 'eq', value: '' }]
                            : r.conditions,
                      });
                    }}
                  >
                    <option value="fixed">Fixed points</option>
                    <option value="table">From a score table</option>
                    <option value="sibling">Sibling checked</option>
                  </select>
                </label>
                {r.kind !== 'table' ? (
                  <label className="ep-field ep-pts__points">
                    <span className="ep-field__label">Points</span>
                    <input
                      className="ep-input"
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={Number.isNaN(r.points) ? '' : r.points}
                      onChange={(e) => {
                        const t = e.target.value.replace(/[^\d.-]/g, '');
                        put(i, { points: t === '' || t === '-' ? Number.NaN : Number(t) });
                      }}
                    />
                  </label>
                ) : null}
                <label className="ep-field ep-pts__points">
                  <span className="ep-field__label">At most</span>
                  <input
                    className="ep-input"
                    inputMode="decimal"
                    placeholder="No cap"
                    disabled={!canEdit}
                    value={r.cap ?? ''}
                    onChange={(e) => put(i, { cap: numOrNull(e.target.value) })}
                  />
                </label>
                {canEdit ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove ${r.name || 'this criterion'}`}
                    onClick={() => onChange(rules.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {r.kind === 'table' ? (
                <TableSpec
                  spec={r.spec ?? {}}
                  fields={fields}
                  canEdit={canEdit}
                  onChange={(spec) => put(i, { spec })}
                />
              ) : r.kind === 'sibling' ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  The admission numbers the family gives for siblings are looked up among the
                  school&rsquo;s students; the points count only when one is found (else Document
                  check is told).
                </p>
              ) : (
                <label className="ep-field" style={{ maxWidth: '28rem' }}>
                  <span className="ep-field__label">Proof needed (optional)</span>
                  <select
                    className="ep-select"
                    disabled={!canEdit}
                    value={r.spec?.proof ?? ''}
                    onChange={(e) =>
                      put(i, { spec: { ...(r.spec ?? {}), proof: e.target.value || null } })
                    }
                  >
                    <option value="">No proof needed</option>
                    {proofs.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {r.kind && r.kind !== 'fixed' && !r.conditions.length ? (
                canEdit ? (
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() =>
                      put(i, { conditions: [{ field: fields[0]?.key ?? '', op: 'eq', value: '' }] })
                    }
                  >
                    Only when… (add a condition)
                  </button>
                ) : null
              ) : (
                <div className="ep-pts__conds">
                  <span className="ep-field__help">
                    {r.kind && r.kind !== 'fixed' ? 'Only when' : 'When'}
                  </span>
                  {r.conditions.length > 1 ? (
                    <select
                      className="ep-select ep-pts__logic"
                      aria-label="All or any"
                      disabled={!canEdit}
                      value={r.logic}
                      onChange={(e) => put(i, { logic: e.target.value as 'all' | 'any' })}
                    >
                      <option value="all">all of these hold</option>
                      <option value="any">any of these holds</option>
                    </select>
                  ) : null}
                  {r.conditions.map((c, m) => {
                    const f = field(c.field);
                    return (
                      <div key={m} className="ep-fb__cond">
                        <select
                          className="ep-select"
                          aria-label="Question"
                          disabled={!canEdit}
                          value={c.field}
                          onChange={(e) => putCond(i, m, { field: e.target.value })}
                        >
                          {f ? null : <option value={c.field}>{c.field} (not on a form)</option>}
                          {fields.map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className="ep-select"
                          aria-label="Condition"
                          disabled={!canEdit}
                          value={c.op}
                          onChange={(e) =>
                            putCond(i, m, { op: e.target.value as AdmissionCondition['op'] })
                          }
                        >
                          {RULE_OPS.map((o) => (
                            <option key={o} value={o}>
                              {OP[o]}
                            </option>
                          ))}
                        </select>
                        {c.op !== 'empty' && c.op !== 'not_empty' ? (
                          <>
                            <input
                              className="ep-input"
                              aria-label="Answer"
                              list={f?.values.length ? `${valuesId}-${c.field}` : undefined}
                              disabled={!canEdit}
                              value={c.value ?? ''}
                              onChange={(e) => putCond(i, m, { value: e.target.value })}
                            />
                            {f?.values.length ? (
                              <datalist id={`${valuesId}-${c.field}`}>
                                {f.values.map((v) => (
                                  <option key={v} value={v} />
                                ))}
                              </datalist>
                            ) : null}
                          </>
                        ) : null}
                        {canEdit && (r.conditions.length > 1 || (r.kind ?? 'fixed') !== 'fixed') ? (
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            onClick={() =>
                              put(i, { conditions: r.conditions.filter((_, n) => n !== m) })
                            }
                          >
                            Remove condition
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {canEdit ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() =>
                        put(i, {
                          conditions: [
                            ...r.conditions,
                            { field: fields[0]?.key ?? '', op: 'eq', value: 'Yes' },
                          ],
                        })
                      }
                    >
                      Add a condition
                    </button>
                  ) : null}
                </div>
              )}
              {warn.length ? (
                <p className="ep-sp__feewarn" role="status">
                  {warn.join('; ')}: add the question to that form, or this criterion never matches
                  there.
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canEdit ? (
        <div className="ep-pts__add">
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() =>
              onChange([
                ...rules,
                {
                  name: '',
                  logic: 'all',
                  conditions: [{ field: fields[0]?.key ?? '', op: 'eq', value: '' }],
                  points: 10,
                },
              ])
            }
          >
            Add a criterion
          </button>
          {unused.length ? (
            <label className="ep-field ep-pts__starter">
              <span className="ep-sr-only">Add a ready criterion</span>
              <select
                className="ep-select"
                value=""
                onChange={(e) => {
                  const s = STARTERS.find((x) => x.code === e.target.value);
                  if (!s) return;
                  onChange([
                    ...rules,
                    {
                      name: s.name,
                      logic: s.logic,
                      conditions: structuredClone(s.conditions),
                      points: s.points,
                      kind: s.kind ?? 'fixed',
                      spec: structuredClone(s.spec ?? {}),
                      cap: s.cap ?? null,
                    },
                  ]);
                }}
              >
                <option value="">Add a ready criterion…</option>
                {unused.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} (
                    {s.kind === 'table' ? 'from a score table' : `${String(s.points)} points`})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What a "from a score table" criterion reads: the table and, for each parent (or the child), the question. */
function TableSpec({
  spec,
  fields,
  canEdit,
  onChange,
}: {
  spec: NonNullable<PointRule['spec']>;
  fields: SessionPoints['fields'];
  canEdit: boolean;
  onChange: (s: NonNullable<PointRule['spec']>) => void;
}) {
  const table = spec.table ?? 'qualification';
  const sources = spec.sources ?? [];
  const setSource = (i: number, patch: Partial<(typeof sources)[number]>) =>
    onChange({ ...spec, sources: sources.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const roles: Array<'father' | 'mother' | 'child'> =
    table === 'locality' ? ['child'] : ['father', 'mother'];
  const question = (value: string, label: string, set: (v: string) => void, none?: string) => (
    <label className="ep-field">
      <span className="ep-field__label">{label}</span>
      <select
        className="ep-select"
        disabled={!canEdit}
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">{none ?? 'Choose the question'}</option>
        {value && !fields.some((f) => f.key === value) ? (
          <option value={value}>{value} (not on a form)</option>
        ) : null}
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="ep-pts__conds" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <label className="ep-field" style={{ maxWidth: '20rem' }}>
        <span className="ep-field__label">Score table</span>
        <select
          className="ep-select"
          disabled={!canEdit}
          value={table}
          onChange={(e) => {
            const t = e.target.value as NonNullable<typeof spec.table>;
            onChange({
              table: t,
              school: t === 'alumni_school' ? (spec.school ?? '') : null,
              sources:
                t === 'locality'
                  ? [{ role: 'child', field: '' }]
                  : [
                      { role: 'father', field: '', classField: t === 'alumni_school' ? '' : null },
                      { role: 'mother', field: '', classField: t === 'alumni_school' ? '' : null },
                    ],
            });
          }}
        >
          {Object.entries(TABLE_NAME).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {sources
        .filter((x) => roles.includes(x.role))
        .map((x) => {
          const i = sources.indexOf(x);
          return (
            <div
              key={x.role}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                gap: 'var(--sp-2)',
                alignItems: 'end',
              }}
            >
              <strong className="ep-kicker">{ROLE_NAME[x.role]}</strong>
              {table === 'alumni_school' ? (
                <>
                  {question(
                    x.field,
                    'School studied at',
                    (v) => setSource(i, { field: v }),
                    'Not asked: the school below',
                  )}
                  {question(x.classField ?? '', 'Pass-out class', (v) =>
                    setSource(i, { classField: v }),
                  )}
                </>
              ) : (
                question(
                  x.field,
                  table === 'locality' ? 'Locality question' : 'Qualification question',
                  (v) => setSource(i, { field: v }),
                )
              )}
              {canEdit && sources.length > 1 ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  onClick={() => onChange({ ...spec, sources: sources.filter((_, j) => j !== i) })}
                >
                  Leave out {ROLE_NAME[x.role]?.toLowerCase()}
                </button>
              ) : null}
            </div>
          );
        })}
      {canEdit
        ? roles
            .filter((role) => !sources.some((x) => x.role === role))
            .map((role) => (
              <button
                key={role}
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() =>
                  onChange({
                    ...spec,
                    sources: [
                      ...sources,
                      { role, field: '', classField: table === 'alumni_school' ? '' : null },
                    ],
                  })
                }
              >
                Add {ROLE_NAME[role]?.toLowerCase()}
              </button>
            ))
        : null}
      {table === 'alumni_school' ? (
        <label className="ep-field" style={{ maxWidth: '24rem' }}>
          <span className="ep-field__label">School, when the form does not ask which</span>
          <input
            className="ep-input"
            maxLength={120}
            disabled={!canEdit}
            placeholder="e.g. DPS - Faridabad (as in the Alumni schools table)"
            value={spec.school ?? ''}
            onChange={(e) => onChange({ ...spec, school: e.target.value })}
          />
        </label>
      ) : null}
      <p className="ep-field__help" style={{ margin: 0 }}>
        {table === 'qualification'
          ? "The father's score and the mother's score from the Qualifications table are added."
          : table === 'locality'
            ? "The locality's score from the Localities table (the class's own line first)."
            : "Each alumni parent's score from the Alumni schools table (school + pass-out class), added up to the cap."}{' '}
        <a href={`/admissions/setup/score-tables?t=${table}`}>Open the {TABLE_NAME[table]} table</a>
      </p>
    </div>
  );
}
