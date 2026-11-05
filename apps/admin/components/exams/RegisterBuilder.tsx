'use client';
import {
  Button,
  buildSheet,
  computeRegister,
  countedColumns,
  noPaperMessage,
  registerProblems,
  subjectsWithoutPaper,
  type RegCode,
  type RegisterDef,
  type RegSubject,
} from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { RegisterColumns } from '@/components/exams/RegisterColumns';
import { RegisterSheet } from '@/components/exams/RegisterSheet';
import type { BuilderData } from '@/lib/mark-schemes';
import {
  childrenOf,
  copyColumns,
  membersOf,
  papersOf,
  sampleStudents,
  subjectNote,
  withChildOrder,
  withPartColumns,
} from '@/lib/register-builder';
import { builderData, registerDefOf, saveRegister } from '@/lib/register-actions';

const STEPS = ['Details', 'Subjects', 'Columns', 'Mark codes', 'Totals', 'Final'] as const;
const TREAT: Record<RegCode['treat'], string> = {
  zero: 'Count as 0',
  excl: 'Leave out of the maximum',
  fixed: 'Fixed / grace marks',
  pctmax: '% of the maximum',
  prorata: 'Pro-rata from other exams',
};

export interface BuilderInit {
  id?: string;
  name: string;
  purpose: 'result' | 'register';
  termCode: string | null;
  classIds: string[];
  def: RegisterDef;
  status?: 'draft' | 'locked' | 'superseded';
  version?: number;
}

/**
 * The register builder (docs/design/68), the school's Term Mark Register in six steps: Details (name,
 * classes, order, layout, type), Subjects (subjects, elective slots, their order), Columns (each
 * subject's chain), Mark codes (per exam), Totals (per subject) and Final (the final columns, display,
 * grading). Under it, from the columns on, a preview on two sample students whose marks can be typed
 * over (computed cells green, the final amber). Saving a locked register makes its next version.
 */
export function RegisterBuilder({
  init,
  classes,
  scales,
  registers,
  initialData,
}: {
  init: BuilderInit;
  classes: Array<{ id: string; code: string }>;
  scales: Array<{
    id: string;
    code: string;
    name: string;
    bands: Array<{ grade: string; minPct: number }>;
  }>;
  registers: Array<{ id: string; name: string }>;
  initialData: BuilderData | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(init.name);
  const [purpose, setPurpose] = useState(init.purpose);
  const [termCode, setTermCode] = useState(init.termCode ?? '');
  const [classIds, setClassIds] = useState(init.classIds);
  const [def, setDefState] = useState<RegisterDef>(init.def);
  const [data, setData] = useState<BuilderData | null>(initialData);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{
    tone: 'danger' | 'info';
    text: string;
    /** the problems, one a line */
    lines?: string[];
  } | null>(null);
  const [importFrom, setImportFrom] = useState('');
  const [pending, start] = useTransition();
  const setDef = (fn: (d: RegisterDef) => RegisterDef) => setDefState((d) => fn(d));

  // the classes' subjects, exams and codes
  useEffect(() => {
    if (!classIds.length) {
      setData(null);
      return;
    }
    let live = true;
    void builderData(classIds).then((r) => {
      if (live && r.ok) setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [classIds]);

  // a subject the classes do not have leaves the register (a slot keeps the members they have)
  useEffect(() => {
    if (!data) return;
    const have = new Set(data.subjects.map((x) => x.id));
    setDefState((d) => {
      const subjects = d.subjects
        .map((s) =>
          s.slot
            ? { ...s, slot: { ...s.slot, members: s.slot.members.filter((m) => have.has(m)) } }
            : s,
        )
        .filter((s) => (s.slot ? true : have.has(s.subjectId ?? '')));
      return subjects.length === d.subjects.length &&
        subjects.every((s, i) => s.slot?.members.length === d.subjects[i]!.slot?.members.length)
        ? d
        : { ...d, subjects };
    });
  }, [data]);

  const subjectName = (id: string) => data?.subjects.find((x) => x.id === id)?.name ?? id;
  const titles = useMemo(
    () =>
      Object.fromEntries(
        def.subjects.map((s) => [s.key, s.slot ? s.slot.name : subjectName(s.subjectId ?? '')]),
      ),
    [def.subjects, data],
  );
  const examLabel = (key: string) => {
    const e = def.exams.find((x) => x.key === key);
    const ex = data?.exams.find((x) => x.id === e?.examId);
    return ex ? `${key} · ${ex.name}` : key;
  };

  // docs/design/72: the subjects with no paper of their own in the register's exams (marked inside another)
  const noPaper = useMemo(
    () => (data ? subjectsWithoutPaper(def, data.subjects) : []),
    [def, data],
  );
  const takeOut = () => {
    const gone = new Set(noPaper.map((x) => x.key));
    setDef((d) => ({ ...d, subjects: d.subjects.filter((x) => !gone.has(x.key)) }));
    setMsg({
      tone: 'info',
      text: `Taken out of the register: ${noPaper.map((x) => x.name).join(', ')}. Save it again.`,
    });
  };
  const problems = useMemo(() => {
    // their own column problems go with them: the cause comes first, once
    const gone = new Set(noPaper.map((x) => x.key));
    const out = registerProblems(
      gone.size ? { ...def, subjects: def.subjects.filter((x) => !gone.has(x.key)) } : def,
    );
    const why = noPaperMessage(noPaper);
    if (why) out.unshift(why);
    if (name.trim().length < 2) out.unshift('Give the register a name');
    if (!classIds.length) out.unshift('Choose the classes');
    if (purpose === 'result' && !/^[A-Z0-9_]{1,12}$/.test(termCode.trim().toUpperCase()))
      out.unshift('A result register needs its term (T1, T2 …)');
    return out;
  }, [def, noPaper, name, classIds, purpose, termCode]);

  const preview = useMemo(() => {
    if (!data || !def.subjects.some((s) => s.columns.length) || !def.grades.length) return null;
    try {
      const students = sampleStudents(def, data, given);
      const rows = computeRegister(def, students, {
        exam: def.type === 'examwise' ? def.exams[0]?.key : undefined,
      });
      return {
        students,
        sheet: buildSheet(def, rows, {
          place: 'Sample',
          merit: false,
          division: false,
          order: def.subjects.map((s) => s.key),
          titles,
        }),
      };
    } catch {
      return null;
    }
  }, [def, data, given, titles]);

  const save = () => {
    setMsg(null);
    if (problems.length) {
      setMsg({ tone: 'danger', text: 'To fix first:', lines: problems });
      return;
    }
    start(async () => {
      const r = await saveRegister({
        id: init.id,
        name: name.trim(),
        purpose,
        termCode: purpose === 'result' ? termCode.trim().toUpperCase() : null,
        classIds,
        def,
      });
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      const note =
        init.status === 'locked'
          ? `Saved as version ${String(r.data.version)} (a draft): the locked version stays until this one is locked`
          : 'Saved';
      router.push(`/exams/schemes?ok=1&detail=${encodeURIComponent(note)}`);
    });
  };

  // ---- the steps ---------------------------------------------------------------------------------
  const toggleClass = (id: string, on: boolean) => {
    const next = on ? [...classIds, id] : classIds.filter((x) => x !== id);
    setClassIds(next);
  };
  const plainUsed = new Set(def.subjects.flatMap((s) => (s.slot ? [] : [s.subjectId])));
  const slotUsed = new Set(def.subjects.flatMap((s) => s.slot?.members ?? []));
  const keyFor = (code: string) => {
    const base = code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'S';
    let k = base;
    let n = 2;
    while (def.subjects.some((s) => s.key === k)) k = `${base}${String(n++)}`;
    return k;
  };
  const toggleSubject = (id: string, on: boolean) =>
    setDef((d) => {
      if (!on) return { ...d, subjects: d.subjects.filter((s) => s.subjectId !== id || s.slot) };
      const info = data?.subjects.find((x) => x.id === id);
      const added: RegSubject = {
        key: keyFor(info?.code ?? id),
        subjectId: id,
        columns: [],
        showTotal: true,
        round: 'none',
        grade: true,
        pct: true,
      };
      // a subject ticked once others have columns starts with the first one's chain (copied: the exams
      // it has, its parts shown), so it is not left without columns; it can be changed in step 3
      const model = d.subjects.find((x) => !x.slot && x.columns.length);
      if (model) added.columns = copyColumns(data, model, added, d, { parts: true }).columns;
      return { ...d, subjects: [...d.subjects, added] };
    });
  // a slot made of subjects that have columns takes the first one's chain (a new slot: none yet)
  const chainOf = (d: RegisterDef, members: string[]) =>
    (
      d.subjects.find((s) => !s.slot && members.includes(s.subjectId ?? '') && s.columns.length)
        ?.columns ?? []
    ).map((c) => ({ ...c }));
  const addSlot = (name = 'THIRD LANGUAGE', members: string[] = []) =>
    setDef((d) => ({
      ...d,
      subjects: [
        ...d.subjects.filter((s) => s.slot || !members.includes(s.subjectId ?? '')),
        {
          key: keyFor(`L${String(d.subjects.filter((s) => s.slot).length + 1)}`),
          slot: { name, members },
          columns: chainOf(d, members),
          showTotal: true,
          round: 'none',
          grade: true,
          pct: true,
        },
      ],
    }));
  const setSlot = (key: string, patch: Partial<NonNullable<RegSubject['slot']>>) =>
    setDef((d) => ({
      ...d,
      subjects: d.subjects
        .map((s) =>
          s.key === key && s.slot
            ? {
                ...s,
                slot: { ...s.slot, ...patch },
                // the slot's first members bring their columns (the language's chain)
                columns: s.columns.length ? s.columns : chainOf(d, patch.members ?? []),
              }
            : s,
        )
        // a member of a slot leaves the plain subjects
        .filter((s) => s.slot || !(patch.members ?? []).includes(s.subjectId ?? '')),
    }));
  const moveSubject = (i: number, by: -1 | 1) =>
    setDef((d) => {
      const list = [...d.subjects];
      const j = i + by;
      if (j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...d, subjects: list };
    });
  const setSubject = (key: string, patch: Partial<RegSubject>) =>
    setDef((d) => ({
      ...d,
      subjects: d.subjects.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    }));
  // a composite subject (entered in parts: Social Science — History, Geography …): its parts, their
  // order and whether they print a column each (docs/design/72)
  const composites = def.subjects
    .filter((s) => !s.slot)
    .map((s) => ({ s, kids: childrenOf(data, s) }))
    .filter((x) => x.kids.length > 0);
  const kidsOf = new Map(composites.map((x) => [x.s.key, x.kids]));
  const kidLabel = (s: RegSubject, part: string) => {
    const id = papersOf(data, s)
      .flatMap((p) => p.parts)
      .find((p) => p.name === part)?.subjectId;
    const master = id ? data?.subjects.find((x) => x.id === id)?.name : undefined;
    return master && master.toLowerCase() !== part.toLowerCase() ? `${part} (${master})` : part;
  };
  const [partNote, setPartNote] = useState<string | null>(null);
  const showParts = (s: RegSubject, inColumns = Boolean(s.childInColumns)) => {
    const r = withPartColumns(data, s, def);
    setSubject(s.key, { columns: r.columns, ...(inColumns ? { childInColumns: true } : {}) });
    setPartNote(
      `${titles[s.key] ?? ''}: its parts now show in ${String(r.changed)} exam column(s), ${inColumns ? 'a column each' : 'in one cell with their sum'}; the averages and the total stay as they were. Save the register to keep it.`,
    );
  };
  const setChildInColumns = (s: RegSubject, on: boolean) => {
    // ticked on whole marks: the parts come in first
    if (on && withPartColumns(data, s, def).changed) return showParts(s, true);
    setSubject(s.key, { childInColumns: on });
    setPartNote(null);
  };
  const moveChild = (s: RegSubject, j: number, by: -1 | 1) => {
    const list = [...(kidsOf.get(s.key) ?? [])];
    const k = j + by;
    if (k < 0 || k >= list.length) return;
    [list[j], list[k]] = [list[k]!, list[j]!];
    setSubject(s.key, { childOrder: list, columns: withChildOrder(s.columns, list) });
  };
  const setCodes = (exam: string, list: RegCode[]) =>
    setDef((d) => ({ ...d, codes: { ...d.codes, [exam]: list } }));

  const tiles = (
    name: string,
    items: Array<{
      id: string;
      label: string;
      small?: string;
      checked: boolean;
      disabled?: boolean;
      tone?: 'warning';
    }>,
    onChange: (id: string, on: boolean) => void,
  ) => (
    <div className="ep-mr-tiles" role="group" aria-label={name}>
      {items.map((x) => (
        <label key={x.id} className="ep-mr-tile" data-tone={x.tone}>
          <input
            type="checkbox"
            checked={x.checked}
            disabled={x.disabled}
            onChange={(e) => onChange(x.id, e.target.checked)}
          />
          <span>
            {x.label}
            {x.small ? <small>{x.small}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
  const radios = <T extends string>(
    legend: string,
    value: T,
    options: Array<{ value: T; label: string; hint: string }>,
    onChange: (v: T) => void,
  ) => (
    <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
      <legend className="ep-field__label">{legend}</legend>
      <div className="ep-mr-choice">
        {options.map((o) => (
          <label key={o.value} className="ep-mr-tile">
            <input
              type="radio"
              name={legend}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>
              <strong>{o.label}</strong>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="ep-check" style={{ display: 'flex', marginBottom: 'var(--sp-2)' }}>
      <input
        className="ep-check__input"
        type="checkbox"
        checked={on}
        onChange={(e) => set(e.target.checked)}
      />
      <span className="ep-check__box" aria-hidden="true" /> {label}
    </label>
  );
  const setFinal = (patch: Partial<RegisterDef['final']>) =>
    setDef((d) => ({ ...d, final: { ...d.final, ...patch } }));
  const setDisplay = (patch: Partial<RegisterDef['display']>) =>
    setDef((d) => ({ ...d, display: { ...d.display, ...patch } }));
  const usedExams = def.exams.filter((e) =>
    def.subjects.some((s) =>
      s.columns.some(
        (c) =>
          (c.kind === 'raw' || c.kind === 'part') &&
          (c.exam === e.key || Object.values(c.memberExam ?? {}).includes(e.key)),
      ),
    ),
  );

  const body = [
    // 1. details
    <div key="d">
      <label className="ep-field">
        <span className="ep-field__label">Mark register name *</span>
        <input
          className="ep-input"
          value={name}
          maxLength={120}
          placeholder="e.g. Term I Mark Register — Class VI"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="ep-field__label" style={{ marginBottom: 'var(--sp-2)' }}>
        Classes * — one or more; at Run each section of them is listed
      </p>
      {tiles(
        'Classes',
        classes.map((k) => ({ id: k.id, label: k.code, checked: classIds.includes(k.id) })),
        toggleClass,
      )}
      <div className="ep-rp__row" style={{ marginTop: 'var(--sp-4)' }}>
        <label className="ep-field">
          <span className="ep-field__label">Student order</span>
          <select
            className="ep-select"
            value={def.order}
            onChange={(e) =>
              setDef((d) => ({ ...d, order: e.target.value as RegisterDef['order'] }))
            }
          >
            <option value="roll">Roll no wise</option>
            <option value="alpha">Alphabetically (A–Z)</option>
            <option value="rank">Rank wise — 1st Div, 2nd Div …, then the rest</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Kind</span>
          <select
            className="ep-select"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as typeof purpose)}
          >
            <option value="register">A register</option>
            <option value="result">The term result (report cards, promotion)</option>
          </select>
        </label>
        {purpose === 'result' ? (
          <label className="ep-field">
            <span className="ep-field__label">Term</span>
            <input
              className="ep-input"
              value={termCode}
              maxLength={12}
              placeholder="T1"
              onChange={(e) => setTermCode(e.target.value.toUpperCase())}
            />
          </label>
        ) : null}
      </div>
      {radios(
        'Register table layout',
        def.layout,
        [
          {
            value: 'header',
            label: 'Subjects in the header',
            hint: 'Each subject is a block of columns across the top (ENGLISH, HINDI, SCIENCE …)',
          },
          {
            value: 'vertical',
            label: 'Subject-1, Subject-2 …',
            hint: 'Each student’s own subjects in turn, the subject named in the row — for different electives',
          },
        ],
        (v) => setDef((d) => ({ ...d, layout: v })),
      )}
      {radios(
        'Register type',
        def.type,
        [
          {
            value: 'general',
            label: 'General',
            hint: 'One register with every exam and the combined final',
          },
          {
            value: 'examwise',
            label: 'Exam-wise',
            hint: 'At Run an exam is picked and its own result shown (its marks, total, %, grade, rank)',
          },
        ],
        (v) => setDef((d) => ({ ...d, type: v })),
      )}
    </div>,
    // 2. subjects
    <div key="s">
      <p className="ep-field__label" style={{ marginBottom: 'var(--sp-2)' }}>
        Subjects for this register *
      </p>
      {!data ? <p className="ep-field__help">Choose the classes first (step 1).</p> : null}
      {noPaper.length ? (
        <div className="ep-alert ep-alert--warning" style={{ marginBottom: 'var(--sp-3)' }}>
          {noPaperMessage(noPaper)}.{' '}
          <Button size="sm" variant="secondary" onClick={takeOut}>
            Take them out
          </Button>
        </div>
      ) : null}
      {data
        ? tiles(
            'Subjects',
            data.subjects
              .map((x) => ({ x, n: subjectNote(data, x.id) }))
              .filter(({ x, n }) => n.kind === 'own' || plainUsed.has(x.id))
              .map(({ x, n }) => ({
                id: x.id,
                label: `${x.name} (${x.code})`,
                small: [
                  x.classes.join(', '),
                  n.parts.length ? `parts: ${n.parts.join(', ')} (step 3: Each part a column)` : '',
                  n.kind === 'own'
                    ? n.note
                    : `${n.kind === 'part' ? 'no paper of its own: ' : ''}${n.note} — untick it`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                checked: plainUsed.has(x.id),
                disabled: slotUsed.has(x.id),
                tone: n.kind === 'own' ? undefined : ('warning' as const),
              })),
            toggleSubject,
          )
        : null}
      {data &&
      data.subjects.some((x) => !plainUsed.has(x.id) && subjectNote(data, x.id).kind !== 'own') ? (
        <>
          <p className="ep-field__label" style={{ margin: 'var(--sp-4) 0 var(--sp-2)' }}>
            Not a subject of their own in this year’s exams
          </p>
          {tiles(
            'Not a subject of their own',
            data.subjects
              .filter((x) => !plainUsed.has(x.id))
              .map((x) => ({ x, n: subjectNote(data, x.id) }))
              .filter(({ n }) => n.kind !== 'own')
              .map(({ x, n }) => ({
                id: x.id,
                label: `${x.name} (${x.code})`,
                small: n.note,
                checked: false,
                disabled: true,
              })),
            () => undefined,
          )}
        </>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', margin: 'var(--sp-4) 0' }}>
        <Button size="sm" variant="secondary" onClick={() => addSlot()} disabled={!data}>
          + Elective slot
        </Button>
        {data?.slots.length ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              for (const s of data.slots)
                if (!def.subjects.some((x) => x.slot?.name === s.name.toUpperCase()))
                  addSlot(s.name.toUpperCase(), s.members);
            }}
          >
            Use the classes’ choice groups as slots
          </Button>
        ) : null}
      </div>
      {def.subjects
        .filter((s) => s.slot)
        .map((s) => (
          <div key={s.key} className="ep-mr-subject">
            <div className="ep-mr-subject__head">
              <label className="ep-field" style={{ margin: 0 }}>
                <span className="ep-field__label">Slot name</span>
                <input
                  className="ep-input"
                  value={s.slot!.name}
                  maxLength={40}
                  onChange={(e) => setSlot(s.key, { name: e.target.value.toUpperCase() })}
                />
              </label>
              <span className="ep-field__help" style={{ margin: 0 }}>
                Each student takes one of these; the slot is one block, the marks from their own
                subject.
              </span>
              <span style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDef((d) => ({ ...d, subjects: d.subjects.filter((x) => x.key !== s.key) }))
                }
              >
                Remove slot
              </Button>
            </div>
            <div className="ep-mr-subject__body">
              {tiles(
                `Members of ${s.slot!.name}`,
                (data?.subjects ?? [])
                  .filter(
                    (x) =>
                      s.slot!.members.includes(x.id) || subjectNote(data!, x.id).kind === 'own',
                  )
                  .map((x) => ({
                    id: x.id,
                    label: x.name,
                    checked: s.slot!.members.includes(x.id),
                    disabled: !s.slot!.members.includes(x.id) && slotUsed.has(x.id),
                  })),
                (id, on) =>
                  setSlot(s.key, {
                    members: on
                      ? [...s.slot!.members, id]
                      : s.slot!.members.filter((m) => m !== id),
                  }),
              )}
            </div>
          </div>
        ))}
      {composites.length ? (
        <section
          className="ep-alert ep-alert--info"
          aria-label="Composite subjects"
          style={{ display: 'block', marginTop: 'var(--sp-4)' }}
        >
          <strong>Composite subjects (their parts from the exam papers)</strong>
          <ul style={{ margin: 'var(--sp-2) 0', paddingLeft: 'var(--sp-5)' }}>
            {composites.map(({ s, kids }) => {
              const whole = withPartColumns(data, s, def).changed;
              const shown = s.columns.some((c) => c.kind === 'part');
              return (
                <li key={s.key} style={{ marginBottom: 'var(--sp-2)' }}>
                  <strong>{titles[s.key]}</strong> has sub-subjects:{' '}
                  {kids.map((k) => kidLabel(s, k)).join(', ')}.{' '}
                  {whole ? (
                    <>
                      Its exam columns read only the whole marks, so they do not show yet.{' '}
                      <Button size="sm" variant="secondary" onClick={() => showParts(s)}>
                        Show its parts in each exam
                      </Button>
                    </>
                  ) : shown ? (
                    s.childInColumns ? (
                      'They print a column each in every exam.'
                    ) : (
                      'They print in one cell with their sum in every exam.'
                    )
                  ) : (
                    'In step 3, Same marks as entry brings them in.'
                  )}
                  <label className="ep-check" style={{ display: 'flex', marginTop: 'var(--sp-1)' }}>
                    <input
                      className="ep-check__input"
                      type="checkbox"
                      checked={Boolean(s.childInColumns)}
                      onChange={(e) => setChildInColumns(s, e.target.checked)}
                    />
                    <span className="ep-check__box" aria-hidden="true" /> Child subjects in columns
                    (off: in one cell with their sum)
                  </label>
                </li>
              );
            })}
          </ul>
          {partNote ? (
            <p role="status" style={{ margin: '0 0 var(--sp-2)' }}>
              {partNote}
            </p>
          ) : null}
          <span className="ep-field__help" style={{ margin: 0 }}>
            Their order is set under the subject in the order below.
          </span>
        </section>
      ) : null}
      {def.subjects.length > 1 || composites.some((x) => x.kids.length > 1) ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <p className="ep-field__label" style={{ marginBottom: 'var(--sp-2)' }}>
            Subject order
          </p>
          {def.subjects.length > 1
            ? check(
                'Use this order in the register (off: the class’s subject order)',
                Boolean(def.ownOrder),
                (v) => setDef((d) => ({ ...d, ownOrder: v })),
              )
            : null}
          <ol style={{ margin: 0, paddingLeft: 'var(--sp-5)' }}>
            {def.subjects.map((s, i) => (
              <li key={s.key} style={{ marginBottom: 'var(--sp-1)' }}>
                {titles[s.key]}{' '}
                {kidsOf.has(s.key) ? (
                  <span className="ep-badge ep-badge--info">composite</span>
                ) : null}{' '}
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move ${titles[s.key] ?? ''} up`}
                  disabled={i === 0}
                  onClick={() => moveSubject(i, -1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move ${titles[s.key] ?? ''} down`}
                  disabled={i === def.subjects.length - 1}
                  onClick={() => moveSubject(i, 1)}
                >
                  ▼
                </button>
                {(kidsOf.get(s.key)?.length ?? 0) > 1 ? (
                  <ol
                    aria-label={`Parts of ${titles[s.key] ?? ''}`}
                    style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}
                  >
                    {kidsOf.get(s.key)!.map((k, j, all) => (
                      <li key={k} style={{ marginBottom: 'var(--sp-1)' }}>
                        {kidLabel(s, k)}{' '}
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${k} up`}
                          disabled={j === 0}
                          onClick={() => moveChild(s, j, -1)}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Move ${k} down`}
                          disabled={j === all.length - 1}
                          onClick={() => moveChild(s, j, 1)}
                        >
                          ▼
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>,
    // 3. columns
    <div key="c">
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        For each subject: 1. pick the exam, 2. choose what to add — Same marks as entry, Average /
        best of / sum, Conversion or Attendance — and Add. Tick the columns that count in the total;
        hide a column to keep it in the maths but off the sheet.
      </p>
      {def.subjects.map((s) => (
        <RegisterColumns
          key={s.key}
          def={def}
          setDef={setDef}
          data={data}
          s={s}
          titles={titles}
          subjectName={subjectName}
        />
      ))}
    </div>,
    // 4. codes
    <div key="k">
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        How each code in place of marks counts, exam by exam (AB absent, ML medical leave …). “Holds
        the total” shows “–” for the subject and the final until it is cleared; “show value *”
        prints the value it was replaced with.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <label className="ep-field" style={{ margin: 0 }}>
          <span className="ep-field__label">Import from another register</span>
          <select
            className="ep-select"
            value={importFrom}
            onChange={(e) => setImportFrom(e.target.value)}
          >
            <option value="">Choose a register</option>
            {registers
              .filter((r) => r.id !== init.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={!importFrom}
          onClick={() =>
            start(async () => {
              const r = await registerDefOf(importFrom);
              if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
              setDef((d) => ({
                ...d,
                codes: Object.fromEntries(
                  d.exams.map((e) => [e.key, r.data.codes[e.key] ?? d.codes[e.key] ?? []]),
                ),
                final: { ...d.final, optionalBlocks: r.data.final.optionalBlocks },
              }));
              setMsg({ tone: 'info', text: 'Codes imported for the exams with the same key' });
            })
          }
        >
          Import codes
        </Button>
      </div>
      {!usedExams.length ? <p className="ep-field__help">No exam columns yet (step 3).</p> : null}
      {usedExams.map((e) => {
        const list = def.codes[e.key] ?? [];
        const setRow = (i: number, patch: Partial<RegCode>) =>
          setCodes(
            e.key,
            list.map((x, j) => (j === i ? { ...x, ...patch } : x)),
          );
        return (
          <div key={e.key} className="ep-mr-subject">
            <div className="ep-mr-subject__head">
              <h3>{examLabel(e.key)}</h3>
              <span style={{ flex: 1 }} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDef((d) => ({
                    ...d,
                    codes: Object.fromEntries(
                      d.exams.map((x) => [x.key, list.map((c) => ({ ...c }))]),
                    ),
                  }))
                }
              >
                Copy to the other exams
              </Button>
            </div>
            <div className="ep-mr-subject__body ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Codes of {e.key}</caption>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Meaning</th>
                    <th scope="col">Counts as</th>
                    <th scope="col">Amount / %</th>
                    <th scope="col">Holds the total</th>
                    <th scope="col">Show value *</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c, i) => (
                    <tr key={`${c.code}-${String(i)}`}>
                      <td>
                        <input
                          className="ep-input"
                          aria-label="Code"
                          style={{ width: '5rem' }}
                          value={c.code}
                          maxLength={12}
                          onChange={(ev) => setRow(i, { code: ev.target.value.toUpperCase() })}
                        />
                      </td>
                      <td>
                        <input
                          className="ep-input"
                          aria-label="Meaning"
                          value={c.meaning}
                          maxLength={60}
                          onChange={(ev) => setRow(i, { meaning: ev.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="ep-select"
                          data-native
                          aria-label={`How ${c.code} counts`}
                          value={c.treat}
                          onChange={(ev) =>
                            setRow(i, { treat: ev.target.value as RegCode['treat'] })
                          }
                        >
                          {Object.entries(TREAT).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {c.treat === 'fixed' || c.treat === 'pctmax' || c.treat === 'prorata' ? (
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            style={{ width: '5rem' }}
                            aria-label={`Amount for ${c.code}`}
                            value={(c.treat === 'prorata' ? c.prPct : c.amt) ?? ''}
                            onChange={(ev) =>
                              setRow(
                                i,
                                c.treat === 'prorata'
                                  ? { prPct: ev.target.value ? Number(ev.target.value) : null }
                                  : { amt: ev.target.value ? Number(ev.target.value) : null },
                              )
                            }
                          />
                        ) : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${c.code} holds the total`}
                          checked={c.blocks}
                          onChange={(ev) => setRow(i, { blocks: ev.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Show the value of ${c.code}`}
                          checked={c.showValue}
                          onChange={(ev) => setRow(i, { showValue: ev.target.checked })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${c.code}`}
                          onClick={() =>
                            setCodes(
                              e.key,
                              list.filter((_, j) => j !== i),
                            )
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setCodes(e.key, [
                    ...list,
                    { code: 'NEW', meaning: '', treat: 'excl', blocks: false, showValue: false },
                  ])
                }
              >
                + Add code
              </Button>
            </div>
          </div>
        );
      })}
      {check(
        'Also withhold the final when a code that holds the total is in an optional subject',
        def.final.optionalBlocks,
        (v) => setFinal({ optionalBlocks: v }),
      )}
    </div>,
    // 5. totals
    <div key="t">
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Per subject: rounding of its total, its grade and %. (Which columns count was chosen in step
        3.)
      </p>
      {def.subjects.map((s) => {
        const counted = countedColumns(s.columns).map(
          (k) => s.columns.find((c) => c.key === k)?.name ?? k,
        );
        return (
          <div
            key={s.key}
            className="ep-mr-col"
            style={{ gridTemplateColumns: 'minmax(10rem, 1fr) 2fr auto' }}
          >
            <strong>{titles[s.key]}</strong>
            <span className="ep-mr-col__desc">
              Total = {counted.join(' + ') || '—'}
              {s.totalOutOf ? `, out of ${String(s.totalOutOf)}` : ''}
            </span>
            <span className="ep-mr-col__opts">
              <label>
                round off
                <select
                  className="ep-select"
                  data-native
                  value={s.round ?? 'none'}
                  onChange={(e) =>
                    setSubject(s.key, { round: e.target.value as RegSubject['round'] })
                  }
                >
                  <option value="none">No</option>
                  <option value="keep">Whole, .5 kept</option>
                  <option value="up">Whole, .5 up</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.grade !== false}
                  onChange={(e) => setSubject(s.key, { grade: e.target.checked })}
                />{' '}
                grade
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={s.pct !== false}
                  onChange={(e) => setSubject(s.key, { pct: e.target.checked })}
                />{' '}
                %
              </label>
              {def.final.optionalMode === 'register' ? (
                <label>
                  <input
                    type="checkbox"
                    checked={s.countInFinal !== false}
                    onChange={(e) => setSubject(s.key, { countInFinal: e.target.checked })}
                  />{' '}
                  counts in the final
                </label>
              ) : null}
              <label>
                heading
                <input
                  className="ep-input"
                  style={{ width: '9rem' }}
                  value={s.totalLabel ?? ''}
                  placeholder="Total"
                  maxLength={40}
                  onChange={(e) => setSubject(s.key, { totalLabel: e.target.value || undefined })}
                />
              </label>
            </span>
          </div>
        );
      })}
    </div>,
    // 6. final
    <div key="f" className="ep-rp">
      <div className="ep-card" style={{ padding: 'var(--sp-4)' }}>
        <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Final result columns
        </h3>
        {check('Final total (the counted subjects added)', def.final.total, (v) =>
          setFinal({ total: v }),
        )}
        {check('Final percentage', def.final.pct, (v) => setFinal({ pct: v }))}
        {check('Final grade', def.final.grade, (v) => setFinal({ grade: v }))}
        {check('Rank', def.final.rank, (v) => setFinal({ rank: v }))}
        <div className="ep-rp__row">
          <label className="ep-field">
            <span className="ep-field__label">Rank by</span>
            <select
              className="ep-select"
              value={def.final.rankBy}
              onChange={(e) => setFinal({ rankBy: e.target.value as 'total' | 'pct' })}
            >
              <option value="total">Final total</option>
              <option value="pct">Final %</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Round off the final total</span>
            <select
              className="ep-select"
              value={def.final.round}
              onChange={(e) => setFinal({ round: e.target.value as RegisterDef['final']['round'] })}
            >
              <option value="none">No (10.75 stays 10.75)</option>
              <option value="up">.5 goes up (10.5 → 11)</option>
              <option value="keep">.5 stays (10.5 → 10.5)</option>
            </select>
          </label>
        </div>
        {check('Result column (Pass / Compartment / Fail / Absent)', def.final.result, (v) =>
          setFinal({ result: v }),
        )}
        <div className="ep-rp__row">
          <label className="ep-field">
            <span className="ep-field__label">Pass %</span>
            <input
              className="ep-input"
              type="number"
              min={0}
              max={100}
              value={def.final.passPct}
              onChange={(e) => setFinal({ passPct: Number(e.target.value) })}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Compartment up to (subjects)</span>
            <input
              className="ep-input"
              type="number"
              min={0}
              max={5}
              value={def.final.compartmentUpTo}
              onChange={(e) => setFinal({ compartmentUpTo: Number(e.target.value) })}
            />
          </label>
        </div>
        {check('Theory and practical must each pass (XI-XII)', def.final.partsEach, (v) =>
          setFinal({ partsEach: v }),
        )}
        {radios(
          'Optional subjects are decided by',
          def.final.optionalMode,
          [
            {
              value: 'choices',
              label: 'The subject choices (per student)',
              hint: 'A student’s additional subject is printed, and kept out of the final unless added below',
            },
            {
              value: 'register',
              label: 'This register',
              hint: 'Each subject’s “counts in the final” (step 5), the same for everyone',
            },
          ],
          (v) => setFinal({ optionalMode: v }),
        )}
        {def.final.optionalMode === 'choices'
          ? check('Additional subjects add into the final total', def.final.optionalInFinal, (v) =>
              setFinal({ optionalInFinal: v }),
            )
          : null}
        {check('Show maximum marks (total / max)', def.display.showMax, (v) =>
          setDisplay({ showMax: v }),
        )}
        <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
          <legend className="ep-field__label">Student columns — order and show</legend>
          {def.display.studentCols.map((c, i) => (
            <div key={c.key} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <label className="ep-check">
                <input
                  className="ep-check__input"
                  type="checkbox"
                  checked={c.show || c.key === 'name'}
                  disabled={c.key === 'name'}
                  onChange={(e) =>
                    setDisplay({
                      studentCols: def.display.studentCols.map((x) =>
                        x.key === c.key ? { ...x, show: e.target.checked } : x,
                      ),
                    })
                  }
                />
                <span className="ep-check__box" aria-hidden="true" />{' '}
                {{ sr: 'Sr no', name: 'Student name', roll: 'Roll no', adm: 'Admission no' }[c.key]}
              </label>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => {
                  const l = [...def.display.studentCols];
                  [l[i - 1], l[i]] = [l[i]!, l[i - 1]!];
                  setDisplay({ studentCols: l });
                }}
              >
                ▲
              </button>
            </div>
          ))}
        </fieldset>
        {check('Show the division (1st Div / Pass …)', def.display.divisionLabel, (v) =>
          setDisplay({ divisionLabel: v }),
        )}
        {check('Proper-case names (ABHISHEK VERMA → Abhishek Verma)', def.display.properCase, (v) =>
          setDisplay({ properCase: v }),
        )}
        {check(
          'Blank cells for subjects a student does not take (instead of —)',
          def.display.blankNotTaken,
          (v) => setDisplay({ blankNotTaken: v }),
        )}
        {check(
          'Show each part’s maximum in breakup cells (PHY 9.5 / 12)',
          def.display.childMax,
          (v) => setDisplay({ childMax: v }),
        )}
        {check('Class-average row at the bottom', def.display.averages, (v) =>
          setDisplay({ averages: v }),
        )}
        <div className="ep-rp__row">
          <label className="ep-field">
            <span className="ep-field__label">Decimals (subject values)</span>
            <select
              className="ep-select"
              value={String(def.display.decimals)}
              onChange={(e) =>
                setDisplay({
                  decimals: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 1 | 2),
                })
              }
            >
              <option value="auto">Auto (35, 35.5)</option>
              <option value="1">1 decimal (35.0)</option>
              <option value="2">2 decimals (35.00)</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Final total decimals</span>
            <select
              className="ep-select"
              value={String(def.display.finalDecimals)}
              onChange={(e) =>
                setDisplay({
                  finalDecimals:
                    e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 0 | 1 | 2),
                })
              }
            >
              <option value="auto">Same as values</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Percentage decimals</span>
            <select
              className="ep-select"
              value={String(def.display.pctDecimals)}
              onChange={(e) =>
                setDisplay({
                  pctDecimals:
                    e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 0 | 1 | 2),
                })
              }
            >
              <option value="auto">Same as the final total</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        </div>
      </div>
      <div className="ep-card" style={{ padding: 'var(--sp-4)' }}>
        <h3 className="ep-cdash__h3" style={{ marginTop: 0 }}>
          Grading scale
        </h3>
        <label className="ep-field">
          <span className="ep-field__label">Start from a scale</span>
          <select
            className="ep-select"
            value=""
            onChange={(e) => {
              const sc = scales.find((x) => x.id === e.target.value);
              if (sc)
                setDef((d) => ({
                  ...d,
                  gradeScaleId: sc.id,
                  grades: sc.bands.map((b) => ({ ...b })),
                }));
            }}
          >
            <option value="">Choose a scale to copy its bands</option>
            {scales.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
        </label>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Grade bands</caption>
          <thead>
            <tr>
              <th scope="col">Grade</th>
              <th scope="col">From %</th>
              <th scope="col">
                <span className="ep-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {def.grades.map((g, i) => (
              <tr key={String(i)}>
                <td>
                  <input
                    className="ep-input"
                    aria-label="Grade"
                    style={{ width: '5rem' }}
                    value={g.grade}
                    maxLength={10}
                    onChange={(e) =>
                      setDef((d) => ({
                        ...d,
                        grades: d.grades.map((x, j) =>
                          j === i ? { ...x, grade: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`From % for ${g.grade}`}
                    type="number"
                    min={0}
                    max={100}
                    style={{ width: '6rem' }}
                    value={g.minPct}
                    onChange={(e) =>
                      setDef((d) => ({
                        ...d,
                        grades: d.grades.map((x, j) =>
                          j === i ? { ...x, minPct: Number(e.target.value) } : x,
                        ),
                      }))
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove ${g.grade}`}
                    onClick={() =>
                      setDef((d) => ({ ...d, grades: d.grades.filter((_, j) => j !== i) }))
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDef((d) => ({ ...d, grades: [...d.grades, { grade: '', minPct: 0 }] }))}
        >
          + Grade
        </Button>
        <h3 className="ep-cdash__h3">Divisions</h3>
        {def.divisions.map((x, i) => (
          <div
            key={String(i)}
            style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}
          >
            <input
              className="ep-input"
              aria-label="Division"
              value={x.name}
              maxLength={30}
              onChange={(e) =>
                setDef((d) => ({
                  ...d,
                  divisions: d.divisions.map((y, j) =>
                    j === i ? { ...y, name: e.target.value } : y,
                  ),
                }))
              }
            />
            <input
              className="ep-input"
              aria-label={`From % for ${x.name}`}
              type="number"
              min={0}
              max={100}
              style={{ width: '6rem' }}
              value={x.minPct}
              onChange={(e) =>
                setDef((d) => ({
                  ...d,
                  divisions: d.divisions.map((y, j) =>
                    j === i ? { ...y, minPct: Number(e.target.value) } : y,
                  ),
                }))
              }
            />
          </div>
        ))}
        {check('Result analysis on Run (its bands and cut-offs)', def.analysis.enabled, (v) =>
          setDef((d) => ({ ...d, analysis: { ...d.analysis, enabled: v } })),
        )}
        {def.analysis.enabled ? (
          <p className="ep-field__help">
            Bands {def.analysis.bands.map((b) => b.label).join(', ')} · cut-offs{' '}
            {def.analysis.cumulative.map((c) => `${c.op}${String(c.pct)}%`).join(', ')}
          </p>
        ) : null}
      </div>
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
              onClick={() => setStep(i)}
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
          {msg.lines?.length ? (
            <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
              {msg.lines.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {msg.lines && noPaper.length ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={takeOut}
              style={{ marginTop: 'var(--sp-2)' }}
            >
              Take them out
            </Button>
          ) : null}
        </div>
      ) : null}
      {body[step]}
      {step === 5 && problems.length ? (
        <div className="ep-alert ep-alert--warning" style={{ marginTop: 'var(--sp-3)' }}>
          To fix before saving:
          <ul style={{ margin: 'var(--sp-1) 0 0', paddingLeft: 'var(--sp-5)' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {noPaper.length ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={takeOut}
              style={{ marginTop: 'var(--sp-2)' }}
            >
              Take them out
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        className="ep-form-actions"
        style={{ justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}
      >
        <Button
          variant="ghost"
          onClick={() => setStep((n) => Math.max(0, n - 1))}
          disabled={step === 0}
        >
          ← Back
        </Button>
        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
          {init.id || step === 5 ? (
            <Button variant={step === 5 ? 'primary' : 'secondary'} onClick={save} loading={pending}>
              {init.status === 'locked' ? 'Save as the next version' : 'Save register'}
            </Button>
          ) : null}
          {step < 5 ? <Button onClick={() => setStep((n) => n + 1)}>Next →</Button> : null}
        </span>
      </div>

      {step >= 2 && preview ? (
        <section className="ep-mr-preview" aria-label="Preview">
          <div className="ep-mr-preview__head">
            <strong>Preview — two sample students (not real marks)</strong>
            <span className="ep-field__help" style={{ margin: 0 }}>
              Type over a mark (or a code such as AB, ML) to try the formulas; the real students
              come at Run.
            </span>
            <span style={{ flex: 1 }} />
            <span className="ep-mr-legend">
              <span>
                <i data-tone="calc" />
                worked out
              </span>
              <span>
                <i data-tone="final" />
                final
              </span>
            </span>
          </div>
          <div className="ep-mr-preview__body">
            <details style={{ marginBottom: 'var(--sp-3)' }}>
              <summary>The sample marks</summary>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Sample marks">
                <table className="ep-table ep-table--dense ep-mr-sheet">
                  <caption className="ep-sr-only">Sample marks</caption>
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Subject</th>
                      {def.exams.map((e) => (
                        <th key={e.key} scope="col">
                          {e.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.students.flatMap((st, i) =>
                      def.subjects.map((s) => {
                        const sub = st.subjects.find((x) => membersOf(s).includes(x.subjectId));
                        return (
                          <tr key={`${st.studentId}-${s.key}`}>
                            <td data-text="true">{st.name}</td>
                            <td data-text="true">{sub?.code ?? titles[s.key]}</td>
                            {def.exams.map((e) => {
                              const m = sub?.marks[e.key];
                              const k = `${String(i)}|${s.key}|${e.key}`;
                              return (
                                <td key={e.key}>
                                  {m ? (
                                    <input
                                      className="ep-input"
                                      aria-label={`${st.name} ${sub?.code ?? ''} ${e.key} (out of ${String(m.max)})`}
                                      value={given[k] ?? String(m.code ?? m.marks ?? '')}
                                      onChange={(ev) =>
                                        setGiven((g) => ({ ...g, [k]: ev.target.value }))
                                      }
                                    />
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
            <RegisterSheet sheet={preview.sheet} label="Preview of the register" />
          </div>
        </section>
      ) : null}
    </div>
  );
}
