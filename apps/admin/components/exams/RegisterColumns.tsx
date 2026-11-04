'use client';
import { Button, Dialog, type RegColumn, type RegisterDef, type RegSubject } from '@edupro/ui';
import { useState } from 'react';
import { COLUMN_KIND, type BuilderData } from '@/lib/mark-schemes';
import {
  columnKey,
  copyColumns,
  describe,
  dropColumn,
  examsOfSubject,
  membersOf,
  partsOf,
  papersOf,
  weightageColumns,
  withExam,
} from '@/lib/register-builder';

const SLABS = '96 5, 91 4, 86 3, 81 2, 76 1';
const slabsOf = (text: string) =>
  text
    .split(',')
    .map((x) => x.trim().split(/\s+/).map(Number))
    .filter((x) => x.length === 2 && x.every((n) => Number.isFinite(n)))
    .map(([minPct, marks]) => ({ minPct: minPct!, marks: marks! }));
const slabsText = (c: RegColumn) =>
  (c.slabs ?? []).map((x) => `${String(x.minPct)} ${String(x.marks)}`).join(', ');

type AddKind = 'same' | 'avg' | 'conv' | 'attendance';

/**
 * Step 3 of the register builder (docs/design/68), one subject: its columns in order (each with its
 * options: in the final total, a grade after it, round off, hide, show code, where a pro-rata code takes
 * its marks), and the add bar: pick the exam, then Same marks as entry, Average / Best of / Sum,
 * Conversion or Attendance. Copy to subjects and the Weightage builder save a long set-up.
 */
export function RegisterColumns({
  def,
  setDef,
  data,
  s,
  titles,
  subjectName,
}: {
  def: RegisterDef;
  setDef: (fn: (d: RegisterDef) => RegisterDef) => void;
  data: BuilderData | null;
  s: RegSubject;
  titles: Record<string, string>;
  subjectName: (id: string) => string;
}) {
  const cols = s.columns;
  const exams = examsOfSubject(data, s);
  const composite = papersOf(data, s).some((p) => p.parts.length > 0);
  const [examId, setExamId] = useState(exams[0]?.examId ?? '');
  const [kind, setKind] = useState<AddKind>('same');
  const [how, setHow] = useState<'whole' | 'parts' | 'breakup'>('whole');
  const [avgFrom, setAvgFrom] = useState<'cols' | 'parts'>('cols');
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'best' | 'sum'>('all');
  const [best, setBest] = useState('2');
  const [agg, setAgg] = useState<'avg' | 'sum'>('avg');
  const [convFrom, setConvFrom] = useState<'exam' | 'col'>('exam');
  const [convCol, setConvCol] = useState('');
  const [method, setMethod] = useState<'scale' | 'weight'>('scale');
  const [target, setTarget] = useState('10');
  const [rest, setRest] = useState(false);
  const [eachPart, setEachPart] = useState(false);
  const [name, setName] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [wOpen, setWOpen] = useState(false);
  const [wRows, setWRows] = useState<
    Array<{
      examId: string;
      part: string | null;
      label: string;
      use: 'raw' | 'weighted' | 'skip';
      target: string;
    }>
  >([]);

  const parts = examId ? partsOf(data, s, examId) : [];
  const examCode = data?.exams.find((e) => e.id === examId)?.code ?? '';
  const update = (
    fn: (cols: RegColumn[]) => RegColumn[],
    extra?: (d: RegisterDef) => RegisterDef,
  ) =>
    setDef((d) => {
      const next = extra ? extra(d) : d;
      return {
        ...next,
        subjects: next.subjects.map((x) =>
          x.key === s.key ? { ...x, columns: fn(x.columns) } : x,
        ),
      };
    });
  const setCol = (key: string, patch: Partial<RegColumn>) =>
    update((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const move = (i: number, by: -1 | 1) =>
    update((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const add = () => {
    setNote(null);
    setDef((d0) => {
      let d = d0;
      let list = [...(d.subjects.find((x) => x.key === s.key)?.columns ?? [])];
      const label = name.trim();
      const needExam =
        kind === 'same' ||
        (kind === 'conv' && convFrom === 'exam') ||
        (kind === 'avg' && avgFrom === 'parts');
      let key = '';
      if (needExam || kind === 'attendance') {
        if (examId) {
          const w = withExam(d, data, examId);
          d = w.def;
          key = w.key;
        } else if (kind !== 'attendance') return d0;
      }
      const push = (c: Omit<RegColumn, 'key'> & { key?: string }) => {
        const col = {
          ...c,
          key: c.key ?? columnKey(list, c.name.replace(/\s+/g, '')),
        } as RegColumn;
        list.push(col);
        return col;
      };
      const partCols = (hidden: boolean, group?: string) =>
        parts.map((p) =>
          push({
            name: p,
            kind: 'part',
            exam: key,
            part: p,
            hidden,
            subFrom: 'skip',
            ...(group
              ? {
                  group,
                  groupLabel: `${examCode} (${parts.map((x) => x.slice(0, 3).toUpperCase()).join('/')})`,
                  groupFoot: 'sum' as const,
                }
              : { inTotal: !hidden }),
          }),
        );
      const untick = (keys: string[]) => {
        list = list.map((c) => (keys.includes(c.key) ? { ...c, inTotal: false } : c));
      };
      if (kind === 'same') {
        if (how === 'whole' || !parts.length)
          push({ name: label || examCode, kind: 'raw', exam: key, inTotal: true, subFrom: 'skip' });
        else if (how === 'parts') partCols(false);
        else {
          const g = columnKey(list, `g${examCode}`);
          const ps = partCols(false, g);
          push({
            name: label || `${examCode} sum`,
            kind: 'avg',
            mode: 'sum',
            of: ps.map((c) => c.key),
            hidden: true,
            inTotal: true,
          });
        }
      } else if (kind === 'avg') {
        const of =
          avgFrom === 'parts'
            ? partCols(true).map((c) => c.key)
            : picked.filter((k) => list.some((c) => c.key === k));
        if (!of.length) return d0;
        untick(of);
        push({
          name: label || (mode === 'sum' ? 'Sum' : mode === 'best' ? `Best ${best}` : 'Average'),
          kind: 'avg',
          mode,
          ...(mode === 'best' ? { best: Math.max(1, Number(best) || 1), agg } : {}),
          of,
          inTotal: true,
        });
      } else if (kind === 'conv') {
        const t: number | 'rest' = rest ? 'rest' : Number(target);
        if (t !== 'rest' && !(t > 0)) return d0;
        const conv = (source: string, nm: string, inTotal: boolean) =>
          push({ name: nm, kind: 'conv', source, method, target: t, inTotal });
        if (convFrom === 'col') {
          if (!list.some((c) => c.key === convCol)) return d0;
          untick([convCol]);
          conv(
            convCol,
            label || `${list.find((c) => c.key === convCol)!.name} (${rest ? 'rest' : target})`,
            true,
          );
        } else if (eachPart && parts.length) {
          const ps = partCols(true);
          const made = ps.map((p) => conv(p.key, `${p.name} (${rest ? 'rest' : target})`, false));
          push({
            name: label || `${examCode} con`,
            kind: 'avg',
            mode: 'sum',
            of: made.map((c) => c.key),
            inTotal: true,
          });
        } else {
          const raw =
            list.find((c) => c.kind === 'raw' && c.exam === key) ??
            push({ name: examCode, kind: 'raw', exam: key, hidden: true, subFrom: 'skip' });
          untick([raw.key]);
          conv(raw.key, label || `${examCode} con (${rest ? 'rest' : target})`, true);
        }
      } else {
        const slabs = slabsOf(SLABS);
        push({
          name: label || 'Attendance',
          kind: 'attendance',
          ...(key ? { exam: key } : {}),
          slabs,
          inTotal: true,
        });
      }
      return {
        ...d,
        subjects: d.subjects.map((x) => (x.key === s.key ? { ...x, columns: list } : x)),
      };
    });
    setName('');
    setPicked([]);
  };

  const others = def.subjects.filter((x) => x.key !== s.key);
  // docs/design/72: what the copy would do to each subject (nothing left: it does not fit)
  const chainExams = [
    ...new Set(cols.filter((c) => c.kind === 'raw' || c.kind === 'part').map((c) => c.exam ?? '')),
  ]
    .filter(Boolean)
    // the exam's own code (PT1-2026), not the register's key for it
    .map((k) => {
      const examId = def.exams.find((e) => e.key === k)?.examId;
      return data?.exams.find((e) => e.id === examId)?.code ?? k;
    });
  const fits = copyOpen
    ? Object.fromEntries(others.map((x) => [x.key, copyColumns(data, s, x, def)]))
    : {};
  const fitting = others.filter((x) => fits[x.key]?.columns.length);
  const applyCopy = () => {
    const lines: string[] = [];
    setDef((d) => ({
      ...d,
      subjects: d.subjects.map((x) => {
        if (!copyTo.includes(x.key)) return x;
        const r = copyColumns(data, s, x, d);
        if (!r.columns.length) return x;
        if (r.skipped.length)
          lines.push(`${titles[x.key] ?? x.key}: left out ${r.skipped.join(', ')}`);
        return { ...x, columns: r.columns };
      }),
    }));
    setNote(lines.length ? lines.join(' · ') : `Copied to ${String(copyTo.length)} subject(s).`);
    setCopyOpen(false);
    setCopyTo([]);
  };
  const openWeightage = () => {
    const rows: typeof wRows = [];
    for (const e of exams) {
      const ps = partsOf(data, s, e.examId);
      const weight = papersOf(data, s).find((p) => p.examId === e.examId)?.weightage;
      if (ps.length)
        for (const p of ps)
          rows.push({ examId: e.examId, part: p, label: `${e.code} ${p}`, use: 'raw', target: '' });
      else
        rows.push({
          examId: e.examId,
          part: null,
          label: e.code,
          use: 'raw',
          target: weight ? String(weight) : '',
        });
    }
    setWRows(rows);
    setWOpen(true);
  };
  const buildWeightage = () => {
    setDef((d0) => {
      let d = d0;
      const rows = wRows.map((r) => {
        const w = withExam(d, data, r.examId);
        d = w.def;
        return {
          examKey: w.key,
          part: r.part,
          label: r.label.replace(/\s+/g, ''),
          use: r.use,
          target: Number(r.target) || 0,
        };
      });
      const columns = weightageColumns(rows.filter((r) => r.use !== 'weighted' || r.target > 0));
      return { ...d, subjects: d.subjects.map((x) => (x.key === s.key ? { ...x, columns } : x)) };
    });
    setWOpen(false);
  };

  const setSubject = (patch: Partial<RegSubject>) =>
    setDef((d) => ({
      ...d,
      subjects: d.subjects.map((x) => (x.key === s.key ? { ...x, ...patch } : x)),
    }));
  const memberExams = (member: string) =>
    data?.exams.filter((e) =>
      data.subjects.find((x) => x.id === member)?.papers.some((p) => p.examId === e.id),
    ) ?? [];

  return (
    <section className="ep-mr-subject" aria-label={titles[s.key]}>
      <div className="ep-mr-subject__head">
        <h3>{titles[s.key]}</h3>
        {composite ? <span className="ep-badge ep-badge--info">composite</span> : null}
        {s.slot ? (
          <span className="ep-field__help" style={{ margin: 0 }}>
            {s.slot.members.map(subjectName).join(' · ')}
          </span>
        ) : null}
        <span className="ep-field__help" style={{ margin: 0 }}>
          {cols.length} columns · {cols.filter((c) => c.inTotal).length} in the total
        </span>
        <span style={{ flex: 1 }} />
        <label className="ep-check">
          <input
            className="ep-check__input"
            type="checkbox"
            checked={s.showTotal !== false}
            onChange={(e) => setSubject({ showTotal: e.target.checked })}
          />
          <span className="ep-check__box" aria-hidden="true" /> Show subject total
        </label>
        {composite ? (
          <label className="ep-check">
            <input
              className="ep-check__input"
              type="checkbox"
              checked={Boolean(s.childInColumns)}
              onChange={(e) => setSubject({ childInColumns: e.target.checked })}
            />
            <span className="ep-check__box" aria-hidden="true" /> Parts in columns
          </label>
        ) : null}
        <label className="ep-field" style={{ margin: 0, width: '8rem' }}>
          <span className="ep-field__label">Total out of</span>
          <input
            className="ep-input"
            type="number"
            min={1}
            placeholder="as is"
            value={s.totalOutOf ?? ''}
            onChange={(e) =>
              setSubject({ totalOutOf: e.target.value ? Number(e.target.value) : null })
            }
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setCopyOpen(true)}
          disabled={!others.length || !cols.length}
        >
          Copy to subjects
        </Button>
        <Button size="sm" variant="ghost" onClick={openWeightage} disabled={!exams.length}>
          Weightage builder
        </Button>
      </div>
      <div className="ep-mr-subject__body">
        {note ? (
          <p className="ep-alert ep-alert--info" role="status" style={{ marginTop: 0 }}>
            {note}
          </p>
        ) : null}
        {!cols.length ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            No columns yet: pick the exam and what to add below.
          </p>
        ) : null}
        {cols.map((c, i) => (
          <div className="ep-mr-col" key={c.key} data-hidden={c.hidden ? 'true' : undefined}>
            <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Move ${c.name} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-label={`Move ${c.name} down`}
                disabled={i === cols.length - 1}
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
            </span>
            <span className="ep-mr-chip" data-kind={c.kind}>
              {COLUMN_KIND[c.kind]}
            </span>
            <span>
              <input
                className="ep-input"
                aria-label="Column name"
                value={c.name}
                maxLength={60}
                onChange={(e) => setCol(c.key, { name: e.target.value })}
              />
              <span className="ep-mr-col__desc">{describe(c, cols)}</span>
            </span>
            <span className="ep-mr-col__opts">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(c.inTotal)}
                  onChange={(e) => setCol(c.key, { inTotal: e.target.checked })}
                />{' '}
                in total
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(c.grade)}
                  disabled={c.hidden}
                  onChange={(e) => setCol(c.key, { grade: e.target.checked })}
                />{' '}
                grade
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(c.round)}
                  onChange={(e) => setCol(c.key, { round: e.target.checked })}
                />{' '}
                round off
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(c.hidden)}
                  onChange={(e) => setCol(c.key, { hidden: e.target.checked })}
                />{' '}
                hide
              </label>
              {c.kind === 'conv' ? (
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(c.showCode)}
                    onChange={(e) => setCol(c.key, { showCode: e.target.checked })}
                  />{' '}
                  show code
                </label>
              ) : null}
              {c.kind === 'raw' || c.kind === 'part' ? (
                <label>
                  sub from
                  <select
                    className="ep-select"
                    data-native
                    value={c.subFrom ?? ''}
                    onChange={(e) => setCol(c.key, { subFrom: e.target.value })}
                  >
                    <option value="skip">Skip</option>
                    <option value="">All other exams</option>
                    {cols
                      .filter((x) => x.key !== c.key)
                      .map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              {c.kind === 'attendance' ? (
                <label>
                  slabs
                  <input
                    className="ep-input"
                    style={{ width: '14rem' }}
                    defaultValue={slabsText(c)}
                    aria-label="Attendance slabs: from % and marks"
                    onBlur={(e) => setCol(c.key, { slabs: slabsOf(e.target.value) })}
                  />
                </label>
              ) : null}
              {s.slot && c.kind === 'raw'
                ? s.slot.members.map((m) => (
                    <label key={m}>
                      {subjectName(m)}
                      <select
                        className="ep-select"
                        data-native
                        value={
                          c.memberExam && m in c.memberExam
                            ? c.memberExam[m] === null
                              ? '-'
                              : (def.exams.find((e) => e.key === c.memberExam![m])?.examId ?? '')
                            : ''
                        }
                        onChange={(e) =>
                          setDef((d0) => {
                            const v = e.target.value;
                            let d = d0;
                            let key: string | null | undefined;
                            if (v === '-') key = null;
                            else if (v) {
                              const w = withExam(d, data, v);
                              d = w.def;
                              key = w.key;
                            }
                            const memberExam = { ...c.memberExam };
                            if (key === undefined) delete memberExam[m];
                            else memberExam[m] = key;
                            return {
                              ...d,
                              subjects: d.subjects.map((x) =>
                                x.key === s.key
                                  ? {
                                      ...x,
                                      columns: x.columns.map((y) =>
                                        y.key === c.key ? { ...y, memberExam } : y,
                                      ),
                                    }
                                  : x,
                              ),
                            };
                          })
                        }
                      >
                        <option value="">same exam</option>
                        {memberExams(m).map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.code}
                          </option>
                        ))}
                        <option value="-">Not applicable</option>
                      </select>
                    </label>
                  ))
                : null}
              {s.slot && c.kind === 'conv'
                ? s.slot.members.map((m) => (
                    <label key={m}>
                      {subjectName(m)} to
                      <input
                        className="ep-input"
                        type="number"
                        style={{ width: '5rem' }}
                        min={1}
                        value={c.memberTarget?.[m] ?? ''}
                        placeholder={String(c.target ?? '')}
                        onChange={(e) => {
                          const memberTarget = { ...c.memberTarget };
                          if (e.target.value) memberTarget[m] = Number(e.target.value);
                          else delete memberTarget[m];
                          setCol(c.key, { memberTarget });
                        }}
                      />
                    </label>
                  ))
                : null}
            </span>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              aria-label={`Remove ${c.name}`}
              title="Remove (anything made from it loses it too: hide it instead to keep it in the sums)"
              onClick={() => update((list) => dropColumn(list, c.key))}
            >
              ✕
            </button>
          </div>
        ))}

        <div
          className="ep-mr-add"
          aria-label={`Add a column to ${titles[s.key] ?? ''}`}
          role="group"
        >
          <label className="ep-field">
            <span className="ep-field__label">1. Exam</span>
            <select
              className="ep-select"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              disabled={
                (kind === 'avg' && avgFrom === 'cols') || (kind === 'conv' && convFrom === 'col')
              }
            >
              {kind === 'attendance' ? <option value="">Every exam</option> : null}
              {exams.map((e) => (
                <option key={e.examId} value={e.examId}>
                  {e.code} ({e.max})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">2. Add</span>
            <select
              className="ep-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as AddKind)}
            >
              <option value="same">Same marks as entry</option>
              <option value="avg">Average / best of / sum</option>
              <option value="conv">Conversion</option>
              <option value="attendance">Attendance</option>
            </select>
          </label>
          {kind === 'same' && parts.length ? (
            <label className="ep-field">
              <span className="ep-field__label">Parts</span>
              <select
                className="ep-select"
                value={how}
                onChange={(e) => setHow(e.target.value as typeof how)}
              >
                <option value="whole">The whole marks</option>
                <option value="parts">Each part a column</option>
                <option value="breakup">Parts in one cell (+ sum)</option>
              </select>
            </label>
          ) : null}
          {kind === 'avg' ? (
            <>
              <label className="ep-field">
                <span className="ep-field__label">From</span>
                <select
                  className="ep-select"
                  value={avgFrom}
                  onChange={(e) => setAvgFrom(e.target.value as typeof avgFrom)}
                >
                  <option value="cols">Columns of the subject</option>
                  {parts.length ? <option value="parts">The exam’s parts</option> : null}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Make</span>
                <select
                  className="ep-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="all">Average</option>
                  <option value="best">Best of N</option>
                  <option value="sum">Sum</option>
                </select>
              </label>
              {mode === 'best' ? (
                <>
                  <label className="ep-field" style={{ minWidth: '5rem' }}>
                    <span className="ep-field__label">N</span>
                    <input
                      className="ep-input"
                      type="number"
                      min={1}
                      max={10}
                      value={best}
                      onChange={(e) => setBest(e.target.value)}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Combine</span>
                    <select
                      className="ep-select"
                      value={agg}
                      onChange={(e) => setAgg(e.target.value as typeof agg)}
                    >
                      <option value="avg">Average them</option>
                      <option value="sum">Add them</option>
                    </select>
                  </label>
                </>
              ) : null}
              {avgFrom === 'cols' ? (
                <fieldset className="ep-field" style={{ border: 0, margin: 0, padding: 0 }}>
                  <legend className="ep-field__label">Columns</legend>
                  <span className="ep-mr-pills">
                    {cols.map((c) => (
                      <label key={c.key} className="ep-check">
                        <input
                          className="ep-check__input"
                          type="checkbox"
                          checked={picked.includes(c.key)}
                          onChange={(e) =>
                            setPicked((p) =>
                              e.target.checked ? [...p, c.key] : p.filter((k) => k !== c.key),
                            )
                          }
                        />
                        <span className="ep-check__box" aria-hidden="true" /> {c.name}
                      </label>
                    ))}
                  </span>
                </fieldset>
              ) : null}
            </>
          ) : null}
          {kind === 'conv' ? (
            <>
              <label className="ep-field">
                <span className="ep-field__label">Convert</span>
                <select
                  className="ep-select"
                  value={convFrom}
                  onChange={(e) => setConvFrom(e.target.value as typeof convFrom)}
                >
                  <option value="exam">The exam’s marks</option>
                  <option value="col" disabled={!cols.length}>
                    A column of the subject
                  </option>
                </select>
              </label>
              {convFrom === 'col' ? (
                <label className="ep-field">
                  <span className="ep-field__label">Which column</span>
                  <select
                    className="ep-select"
                    value={convCol}
                    onChange={(e) => setConvCol(e.target.value)}
                  >
                    <option value="">Choose</option>
                    {cols.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="ep-field">
                <span className="ep-field__label">Method</span>
                <select
                  className="ep-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                >
                  <option value="scale">Scale to a new maximum</option>
                  <option value="weight">Weightage %</option>
                </select>
              </label>
              <label className="ep-field" style={{ minWidth: '6rem' }}>
                <span className="ep-field__label">
                  {method === 'weight' ? 'Weightage %' : 'Convert to'}
                </span>
                <input
                  className="ep-input"
                  type="number"
                  min={0}
                  value={target}
                  disabled={rest}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              {method === 'scale' ? (
                <label
                  className="ep-check"
                  title="What the other counted columns leave of the subject's 'total out of'"
                >
                  <input
                    className="ep-check__input"
                    type="checkbox"
                    checked={rest}
                    onChange={(e) => setRest(e.target.checked)}
                  />
                  <span className="ep-check__box" aria-hidden="true" /> the rest of the total
                </label>
              ) : null}
              {convFrom === 'exam' && parts.length ? (
                <label className="ep-check">
                  <input
                    className="ep-check__input"
                    type="checkbox"
                    checked={eachPart}
                    onChange={(e) => setEachPart(e.target.checked)}
                  />
                  <span className="ep-check__box" aria-hidden="true" /> each part (+ sum)
                </label>
              ) : null}
            </>
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">Name (optional)</span>
            <input
              className="ep-input"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            onClick={add}
            disabled={(kind === 'same' || (kind === 'conv' && convFrom === 'exam')) && !examId}
          >
            + Add
          </Button>
        </div>
      </div>

      <Dialog
        open={copyOpen}
        title={`Copy the columns of ${titles[s.key] ?? ''}`}
        onClose={() => setCopyOpen(false)}
        primary={{ label: 'Copy columns', onClick: applyCopy }}
      >
        <p style={{ marginTop: 0 }}>
          The same chain is built in each subject ticked (what it had is replaced). Each keeps its
          own maximum; a column on an exam the subject does not have is left out, with what is made
          from it. A subject with none of these exams is not offered.
        </p>
        {fitting.length > 1 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCopyTo(fitting.map((x) => x.key))}
            style={{ marginBottom: 'var(--sp-2)' }}
          >
            Tick every subject it fits
          </Button>
        ) : null}
        <div className="ep-mr-copy-list">
          {others.map((x) => {
            const fit = fits[x.key];
            const none = !fit?.columns.length;
            return (
              <label key={x.key} className="ep-check" data-off={none ? 'true' : undefined}>
                <input
                  className="ep-check__input"
                  type="checkbox"
                  disabled={none}
                  checked={!none && copyTo.includes(x.key)}
                  onChange={(e) =>
                    setCopyTo((p) =>
                      e.target.checked ? [...p, x.key] : p.filter((k) => k !== x.key),
                    )
                  }
                />
                <span className="ep-check__box" aria-hidden="true" /> {titles[x.key]}
                {none ? (
                  <small> — no paper in {chainExams.join(', ') || 'these exams'}</small>
                ) : fit.skipped.length ? (
                  <small> — leaves out {fit.skipped.join(', ')}</small>
                ) : null}
              </label>
            );
          })}
        </div>
      </Dialog>

      <Dialog
        open={wOpen}
        title={`Weightage builder · ${titles[s.key] ?? ''}`}
        onClose={() => setWOpen(false)}
        size="lg"
        primary={{ label: 'Build columns', onClick: buildWeightage }}
      >
        <p style={{ marginTop: 0 }}>
          Raw counts as it is; Weighted is converted to its target and all weighted parts are added
          into one column; Skip leaves it out. Building replaces this subject’s columns.
        </p>
        <div className="ep-table-wrap">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Parts and their weightage</caption>
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col">Use as</th>
                <th scope="col">Target</th>
              </tr>
            </thead>
            <tbody>
              {wRows.map((r, i) => (
                <tr key={`${r.examId}-${r.part ?? ''}`}>
                  <td>{r.label}</td>
                  <td>
                    <select
                      className="ep-select"
                      data-native
                      aria-label={`Use ${r.label} as`}
                      value={r.use}
                      onChange={(e) =>
                        setWRows((rows) =>
                          rows.map((x, j) =>
                            j === i ? { ...x, use: e.target.value as typeof r.use } : x,
                          ),
                        )
                      }
                    >
                      <option value="raw">Raw</option>
                      <option value="weighted">Weighted</option>
                      <option value="skip">Skip</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={0}
                      aria-label={`Target of ${r.label}`}
                      value={r.target}
                      disabled={r.use !== 'weighted'}
                      onChange={(e) =>
                        setWRows((rows) =>
                          rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    </section>
  );
}

export { membersOf };
