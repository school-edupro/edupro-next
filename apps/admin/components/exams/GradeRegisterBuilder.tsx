'use client';
import {
  Button,
  arrange,
  buildGradeSheet,
  gradeProblems,
  sampleGradeData,
  scaleFromLevels,
  type GradeRegisterDef,
  type GradeStudentCol,
} from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { RegisterSheet } from '@/components/exams/RegisterSheet';
import type { GradeBuilderData } from '@/lib/grade-registers';
import { gradeBuilderData, saveGradeRegister } from '@/lib/register-actions';

const STEPS = ['Details', 'Assessments', 'Indicators', 'Display & Save'] as const;
const COL_LABEL: Record<GradeStudentCol, string> = {
  sr: 'Sr No',
  name: 'Student name',
  roll: 'Roll No',
  adm: 'Adm No',
};

export interface GradeBuilderInit {
  id?: string;
  name: string;
  classIds: string[];
  def: GradeRegisterDef;
  status?: 'draft' | 'locked' | 'superseded';
  version?: number;
}

/** a list with one item moved one place up (-1) or down (+1) */
function moved<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function UpDown({ label, onUp, onDown }: { label: string; onUp: () => void; onDown: () => void }) {
  return (
    <span className="ep-gr-move">
      <button type="button" aria-label={`Move ${label} up`} title="Move up" onClick={onUp}>
        ▲
      </button>
      <button type="button" aria-label={`Move ${label} down`} title="Move down" onClick={onDown}>
        ▼
      </button>
    </span>
  );
}

/**
 * The grade register builder (docs/design/69, part 2), the school's legacy Grade Register in four steps:
 * Details (name, classes, student order), Assessments (the exams that rate indicators, each with a short
 * header, in order), Indicators (areas, items and indicators ticked, ordered and given short labels) and
 * Display & Save (the header, the legend, blank grades, the Overall per area with its grade scale, the
 * student columns). From the indicators on, a preview on three sample students. Saving a locked register
 * makes its next version.
 */
export function GradeRegisterBuilder({
  init,
  initialData,
}: {
  init: GradeBuilderInit;
  initialData: GradeBuilderData;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(init.name);
  const [classIds, setClassIds] = useState<string[]>(init.classIds);
  const [def, setDef] = useState<GradeRegisterDef>(init.def);
  const [data, setData] = useState<GradeBuilderData>(initialData);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const examKey = def.exams.map((e) => e.examId).join(',');

  // the exams of the classes, and the tree of the exams ticked
  useEffect(() => {
    let gone = false;
    if (!classIds.length) return;
    setLoading(true);
    void gradeBuilderData(classIds, examKey ? examKey.split(',') : []).then((r) => {
      if (gone) return;
      setLoading(false);
      if (r.ok) setData(r.data);
      else setMsg({ tone: 'danger', text: r.error });
    });
    return () => {
      gone = true;
    };
  }, [classIds, examKey]);

  const tree = data.tree;
  const all = useMemo(
    () => (tree ? arrange(tree, { ...def, exAreas: [], exLeaves: [] }) : []),
    [tree, def],
  );
  const shown = useMemo(() => (tree ? arrange(tree, def) : []), [tree, def]);
  const problems = useMemo(
    () => [
      ...(name.trim().length < 2 ? ['Give the register a name'] : []),
      ...(classIds.length ? [] : ['Choose the classes']),
      ...gradeProblems(def, tree ?? undefined),
    ],
    [name, classIds, def, tree],
  );
  const preview = useMemo(() => {
    if (!shown.length || !def.exams.length) return null;
    const exams = def.exams.map((e) => {
      const x = data.exams.find((y) => y.id === e.examId);
      return {
        examId: e.examId,
        label: e.label || x?.code || 'T',
        name: x ? `${x.code} · ${x.name}` : e.examId,
      };
    });
    const sample = sampleGradeData(shown, def);
    return buildGradeSheet({
      place: 'Sample',
      areas: shown,
      def,
      exams,
      students: sample.students,
      grade: sample.grade,
    });
  }, [shown, def, data.exams]);

  const stepProblem = (i: number): string | null => {
    if (i === 0) {
      if (name.trim().length < 2) return 'Give the register a name';
      if (!classIds.length) return 'Choose at least one class';
    }
    if (i === 1 && !def.exams.length) return 'Tick at least one assessment';
    if (i === 2 && !shown.length) return 'Tick at least one indicator';
    return null;
  };
  const go = (to: number) => {
    // forward: every step on the way must be complete; back: always
    for (let i = step; i < to; i += 1) {
      const p = stepProblem(i);
      if (p) {
        setStep(i);
        setMsg({ tone: 'danger', text: p });
        return;
      }
    }
    setMsg(null);
    setStep(to);
  };

  const save = () => {
    setMsg(null);
    if (problems.length) {
      setMsg({ tone: 'danger', text: `To fix first: ${problems.slice(0, 6).join('; ')}` });
      return;
    }
    start(async () => {
      // the order and labels of indicators that are no longer in the classes' sets are dropped
      const ids = new Set(tree?.leaves.map((l) => l.id) ?? []);
      const clean: GradeRegisterDef = {
        ...def,
        exLeaves: def.exLeaves.filter((x) => ids.has(x)),
        labels: Object.fromEntries(
          Object.entries(def.labels).filter(([k, v]) => ids.has(k) && v.trim()),
        ),
      };
      const r = await saveGradeRegister({ id: init.id, name: name.trim(), classIds, def: clean });
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      const note =
        init.status === 'locked'
          ? `Saved as version ${String(r.data.version)} (a draft): the locked version stays until this one is locked`
          : 'Saved';
      router.push(`/exams/grade-registers?ok=1&detail=${encodeURIComponent(note)}`);
    });
  };

  // ---- step helpers ---------------------------------------------------------------------------------
  const toggleExam = (id: string, on: boolean) =>
    setDef((d) => ({
      ...d,
      exams: on
        ? [...d.exams, { examId: id, label: `T${String(d.exams.length + 1)}` }]
        : d.exams.filter((e) => e.examId !== id),
    }));
  const setOrder = (patch: Partial<GradeRegisterDef['order']>) =>
    setDef((d) => ({ ...d, order: { ...d.order, ...patch } }));
  const toggle = (list: string[], key: string, on: boolean) =>
    on ? list.filter((x) => x !== key) : [...new Set([...list, key])];
  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="ep-check">
      <input
        className="ep-check__input"
        type="checkbox"
        checked={value}
        onChange={(e) => set(e.target.checked)}
      />
      <span className="ep-check__box" aria-hidden="true" /> {label}
    </label>
  );

  const body = [
    // Step 1 — Details
    <div key="d" className="ep-gr-step">
      <label className="ep-field">
        <span className="ep-field__label">Register name *</span>
        <input
          className="ep-input"
          value={name}
          maxLength={150}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <span className="ep-field__help">
          Unique in the year (e.g. Indicator Register Class VI).
        </span>
      </label>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Classes *</legend>
        <div className="ep-mr-tiles">
          {data.classes.map((k) => (
            <label key={k.id} className="ep-mr-tile">
              <input
                type="checkbox"
                checked={classIds.includes(k.id)}
                onChange={(e) =>
                  setClassIds((c) =>
                    e.target.checked ? [...c, k.id] : c.filter((x) => x !== k.id),
                  )
                }
              />
              <span>
                {k.name}
                {k.noGrades ? <small>no grades yet</small> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Student order</legend>
        <div className="ep-mr-tiles">
          {(
            [
              ['roll', 'Roll No wise'],
              ['alpha', 'Alphabetically'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="ep-mr-tile">
              <input
                type="radio"
                name="orderBy"
                checked={def.orderBy === v}
                onChange={() => setDef((d) => ({ ...d, orderBy: v }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>,

    // Step 2 — Assessments
    <div key="a" className="ep-gr-step">
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The exams of the year that rate indicators for the classes chosen. Tick them in the order
        they print; each gets a short header for the sheet (up to 20 letters).
      </p>
      {loading && !data.exams.length ? <p>Loading the exams…</p> : null}
      {!loading && !data.exams.length ? (
        <p className="ep-alert ep-alert--warning">
          No exam of the year rates indicators for these classes yet (Exams → an exam → Set-up:
          Indicators, and the class&apos;s indicator set).
        </p>
      ) : null}
      {def.exams.map((e, i) => {
        const x = data.exams.find((y) => y.id === e.examId);
        return (
          <div key={e.examId} className="ep-gr-row">
            <UpDown
              label={x?.code ?? e.examId}
              onUp={() => setDef((d) => ({ ...d, exams: moved(d.exams, i, -1) }))}
              onDown={() => setDef((d) => ({ ...d, exams: moved(d.exams, i, 1) }))}
            />
            <label className="ep-check">
              <input
                className="ep-check__input"
                type="checkbox"
                checked
                onChange={() => toggleExam(e.examId, false)}
              />
              <span className="ep-check__box" aria-hidden="true" />{' '}
              <strong>{x?.code ?? 'An exam no longer offered'}</strong>
            </label>
            <span className="ep-mr-col__desc">
              {x ? `${x.name} · ${x.classes.join(', ')}` : ''}
            </span>
            <label className="ep-field ep-gr-label">
              <span className="ep-sr-only">Header for {x?.code ?? e.examId}</span>
              <input
                className="ep-input"
                value={e.label}
                maxLength={20}
                placeholder={x?.code ?? ''}
                onChange={(ev) =>
                  setDef((d) => ({
                    ...d,
                    exams: d.exams.map((y, j) => (j === i ? { ...y, label: ev.target.value } : y)),
                  }))
                }
              />
            </label>
          </div>
        );
      })}
      {data.exams
        .filter((x) => !def.exams.some((e) => e.examId === x.id))
        .map((x) => (
          <div key={x.id} className="ep-gr-row" data-off="true">
            <span className="ep-gr-move" aria-hidden="true" />
            <label className="ep-check">
              <input
                className="ep-check__input"
                type="checkbox"
                checked={false}
                onChange={() => toggleExam(x.id, true)}
              />
              <span className="ep-check__box" aria-hidden="true" /> <strong>{x.code}</strong>
            </label>
            <span className="ep-mr-col__desc">
              {x.name} · {x.classes.join(', ')}
            </span>
          </div>
        ))}
    </div>,

    // Step 3 — Indicators
    <div key="i" className="ep-gr-step">
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The indicators of the sets these classes use in the assessments. Untick what the register
        leaves out (an indicator added to a set later shows by itself), move with ▲▼, and give an
        indicator a short header if its text is long.
      </p>
      {loading && !tree ? <p>Loading the indicators…</p> : null}
      {tree && !all.length ? (
        <p className="ep-alert ep-alert--warning">
          The sets of these classes have no rated indicators for the assessments chosen.
        </p>
      ) : null}
      {all.map((a, ai) => {
        const areaOn = !def.exAreas.includes(a.key);
        const leafCount = a.items.reduce((n, it) => n + it.leaves.length, 0);
        return (
          <section key={a.key} className="ep-gr-area" data-off={areaOn ? undefined : 'true'}>
            <div className="ep-gr-row ep-gr-row--area">
              <UpDown
                label={a.name || 'Indicators'}
                onUp={() =>
                  setOrder({
                    areas: moved(
                      all.map((x) => x.key),
                      ai,
                      -1,
                    ),
                  })
                }
                onDown={() =>
                  setOrder({
                    areas: moved(
                      all.map((x) => x.key),
                      ai,
                      1,
                    ),
                  })
                }
              />
              <label className="ep-check">
                <input
                  className="ep-check__input"
                  type="checkbox"
                  checked={areaOn}
                  onChange={(e) =>
                    setDef((d) => ({ ...d, exAreas: toggle(d.exAreas, a.key, e.target.checked) }))
                  }
                />
                <span className="ep-check__box" aria-hidden="true" />{' '}
                <strong>{a.name || 'Indicators (no area)'}</strong>
              </label>
              <span className="ep-mr-col__desc">
                {leafCount} indicator(s) · {a.items[0]?.leaves[0]?.setName ?? ''}
              </span>
              <span style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="secondary"
                disabled={!areaOn}
                onClick={() =>
                  setDef((d) => ({
                    ...d,
                    exLeaves: d.exLeaves.filter(
                      (x) => !a.items.some((it) => it.leaves.some((l) => l.id === x)),
                    ),
                  }))
                }
              >
                Tick all
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!areaOn}
                onClick={() =>
                  setDef((d) => ({
                    ...d,
                    exLeaves: [
                      ...new Set([
                        ...d.exLeaves,
                        ...a.items.flatMap((it) => it.leaves.map((l) => l.id)),
                      ]),
                    ],
                  }))
                }
              >
                Untick all
              </Button>
            </div>
            {a.items.map((it, ii) => {
              const moveItem = (dir: -1 | 1) =>
                setOrder({
                  items: {
                    ...def.order.items,
                    [a.key]: moved(
                      a.items.map((x) => x.key),
                      ii,
                      dir,
                    ),
                  },
                });
              const leafRow = (l: (typeof it.leaves)[number], li: number, single: boolean) => {
                const on = !def.exLeaves.includes(l.id);
                return (
                  <div
                    key={l.id}
                    className={`ep-gr-row ${single ? 'ep-gr-row--item' : 'ep-gr-row--leaf'}`}
                    data-off={on && areaOn ? undefined : 'true'}
                  >
                    <UpDown
                      label={l.name}
                      onUp={() =>
                        single
                          ? moveItem(-1)
                          : setOrder({
                              leaves: {
                                ...def.order.leaves,
                                [it.key]: moved(
                                  it.leaves.map((x) => x.id),
                                  li,
                                  -1,
                                ),
                              },
                            })
                      }
                      onDown={() =>
                        single
                          ? moveItem(1)
                          : setOrder({
                              leaves: {
                                ...def.order.leaves,
                                [it.key]: moved(
                                  it.leaves.map((x) => x.id),
                                  li,
                                  1,
                                ),
                              },
                            })
                      }
                    />
                    <label className="ep-check ep-gr-text">
                      <input
                        className="ep-check__input"
                        type="checkbox"
                        checked={on}
                        disabled={!areaOn}
                        onChange={(e) =>
                          setDef((d) => ({
                            ...d,
                            exLeaves: toggle(d.exLeaves, l.id, e.target.checked),
                          }))
                        }
                      />
                      <span className="ep-check__box" aria-hidden="true" /> {l.name}
                      {l.description ? (
                        <span className="ep-mr-col__desc">{l.description}</span>
                      ) : null}
                    </label>
                    <label className="ep-field ep-gr-label">
                      <span className="ep-sr-only">Short header for {l.name}</span>
                      <input
                        className="ep-input"
                        value={def.labels[l.id] ?? ''}
                        maxLength={60}
                        placeholder="Short header"
                        disabled={!areaOn}
                        onChange={(e) =>
                          setDef((d) => ({
                            ...d,
                            labels: { ...d.labels, [l.id]: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                );
              };
              if (it.single) return leafRow(it.leaves[0]!, 0, true);
              return (
                <div key={it.key}>
                  <div className="ep-gr-row ep-gr-row--item">
                    <UpDown label={it.name} onUp={() => moveItem(-1)} onDown={() => moveItem(1)} />
                    <strong>{it.name}</strong>
                  </div>
                  {it.leaves.map((l, li) => leafRow(l, li, false))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>,

    // Step 4 — Display & Save
    <div key="s" className="ep-gr-step">
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Indicator header (class sheet)</legend>
        <div className="ep-mr-tiles">
          {(
            [
              ['full', 'Full text (or the short header)'],
              ['number', 'Numbered D1, D2 … with a legend'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="ep-mr-tile">
              <input
                type="radio"
                name="descHeader"
                checked={def.descHeader === v}
                onChange={() => setDef((d) => ({ ...d, descHeader: v }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {check('Show the legend under the sheet', def.showLegend, (v) =>
        setDef((d) => ({ ...d, showLegend: v })),
      )}
      {check('Student names in proper case', def.properCase, (v) =>
        setDef((d) => ({ ...d, properCase: v })),
      )}
      <label className="ep-field" style={{ maxWidth: '14rem' }}>
        <span className="ep-field__label">Text for a blank grade</span>
        <input
          className="ep-input"
          value={def.blankText}
          maxLength={5}
          placeholder="e.g. -"
          onChange={(e) => setDef((d) => ({ ...d, blankText: e.target.value }))}
        />
      </label>
      <label className="ep-field" style={{ maxWidth: '24rem' }}>
        <span className="ep-field__label">Overall grade per area</span>
        <select
          className="ep-select"
          value={def.overall}
          onChange={(e) =>
            setDef((d) => ({ ...d, overall: e.target.value as GradeRegisterDef['overall'] }))
          }
        >
          <option value="off">Off</option>
          <option value="mode">Most frequent grade</option>
          <option value="points">By the points of the grade scale</option>
        </select>
        <span className="ep-field__help">
          {def.overall === 'mode'
            ? 'The grade given most often in the area; a tie goes to the grade higher in the scale.'
            : def.overall === 'points'
              ? 'The average of the points of the grades, printed as the scale grade nearest it.'
              : 'No Overall column.'}
        </span>
      </label>
      {def.overall !== 'off' ? (
        <div className="ep-gr-scale">
          <div className="ep-gr-row">
            <strong>Grade scale (best first)</strong>
            <span style={{ flex: 1 }} />
            {data.levels.length ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDef((d) => ({ ...d, scale: scaleFromLevels(data.levels) }))}
              >
                Fill from the indicator levels
              </Button>
            ) : null}
          </div>
          {def.scale.map((x, i) => (
            <div key={i} className="ep-gr-row">
              <UpDown
                label={x.g || 'grade'}
                onUp={() => setDef((d) => ({ ...d, scale: moved(d.scale, i, -1) }))}
                onDown={() => setDef((d) => ({ ...d, scale: moved(d.scale, i, 1) }))}
              />
              <input
                className="ep-input"
                aria-label={`Grade ${String(i + 1)}`}
                style={{ width: '8rem' }}
                maxLength={12}
                value={x.g}
                onChange={(e) =>
                  setDef((d) => ({
                    ...d,
                    scale: d.scale.map((y, j) => (j === i ? { ...y, g: e.target.value } : y)),
                  }))
                }
              />
              <input
                className="ep-input"
                aria-label={`Points of grade ${String(i + 1)}`}
                type="number"
                step={0.5}
                style={{ width: '7rem' }}
                value={x.p ?? ''}
                placeholder="points"
                onChange={(e) =>
                  setDef((d) => ({
                    ...d,
                    scale: d.scale.map((y, j) =>
                      j === i
                        ? { ...y, p: e.target.value === '' ? null : Number(e.target.value) }
                        : y,
                    ),
                  }))
                }
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDef((d) => ({ ...d, scale: d.scale.filter((_, j) => j !== i) }))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={def.scale.length >= 15}
            onClick={() => setDef((d) => ({ ...d, scale: [...d.scale, { g: '', p: null }] }))}
          >
            + Grade
          </Button>
        </div>
      ) : null}
      <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ep-field__label">Student columns</legend>
        {def.studentCols.map((c, i) => (
          <div key={c.key} className="ep-gr-row">
            <UpDown
              label={COL_LABEL[c.key]}
              onUp={() => setDef((d) => ({ ...d, studentCols: moved(d.studentCols, i, -1) }))}
              onDown={() => setDef((d) => ({ ...d, studentCols: moved(d.studentCols, i, 1) }))}
            />
            <label className="ep-check">
              <input
                className="ep-check__input"
                type="checkbox"
                checked={c.show || c.key === 'name'}
                disabled={c.key === 'name'}
                onChange={(e) =>
                  setDef((d) => ({
                    ...d,
                    studentCols: d.studentCols.map((y, j) =>
                      j === i ? { ...y, show: e.target.checked } : y,
                    ),
                  }))
                }
              />
              <span className="ep-check__box" aria-hidden="true" /> {COL_LABEL[c.key]}
              {c.key === 'name' ? ' (always shown)' : ''}
            </label>
          </div>
        ))}
      </fieldset>
    </div>,
  ];

  return (
    <div>
      <ol className="ep-mr-steps" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              data-state={i < step ? 'done' : undefined}
              onClick={() => go(i)}
            >
              <span>Step {i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {msg.text}
        </div>
      ) : null}
      {body[step]}
      {step === 3 && problems.length ? (
        <div className="ep-alert ep-alert--warning" style={{ marginTop: 'var(--sp-3)' }}>
          To fix before saving:
          <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div
        className="ep-form-actions"
        style={{ justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}
      >
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
          <Button variant="ghost" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>
            ← Back
          </Button>
          <a className="ep-btn ep-btn--ghost" href="/exams/grade-registers">
            Cancel
          </a>
        </span>
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
          {init.id || step === 3 ? (
            <Button variant={step === 3 ? 'primary' : 'secondary'} onClick={save} loading={pending}>
              {init.status === 'locked' ? 'Save as the next version' : 'Save register'}
            </Button>
          ) : null}
          {step < 3 ? <Button onClick={() => go(step + 1)}>Next →</Button> : null}
        </span>
      </div>

      {step >= 2 && preview ? (
        <section className="ep-mr-preview" aria-label="Preview">
          <div className="ep-mr-preview__head">
            <strong>Preview — three sample students (not real grades)</strong>
            <span className="ep-field__help" style={{ margin: 0 }}>
              The real students and their grades come at Run, section by section.
            </span>
          </div>
          <div className="ep-mr-preview__body">
            {preview.map((sheet, i) => (
              <div key={i} style={{ marginTop: i ? 'var(--sp-3)' : 0 }}>
                {sheet.note ? <p className="ep-field__help">{sheet.note}</p> : null}
                {sheet.title ? <h3 className="ep-streg-title">{sheet.title}</h3> : null}
                <RegisterSheet
                  sheet={sheet}
                  label={sheet.title ? `Preview · ${sheet.title}` : 'Preview of the register'}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
