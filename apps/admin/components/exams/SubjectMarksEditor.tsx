'use client';
import { Button } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { saveSubjectMarks, type SubjectMarksRow } from '@/lib/subject-marks-actions';

interface Line {
  subjectId: string;
  code: string;
  name: string;
  max: string;
  pass: string;
  scaleId: string;
  optional: boolean;
  /** the subject above it in the subject master */
  parentId: string | null;
  /** a part of that subject (docs/design/70, 0303) */
  isPart: boolean;
}
const lineOf = (r: SubjectMarksRow): Line => ({
  subjectId: r.subjectId,
  code: r.code,
  name: r.name,
  max: String(r.max),
  pass: r.pass === null ? '' : String(r.pass),
  scaleId: r.scaleId ?? '',
  optional: r.optional,
  parentId: r.parentId,
  isPart: r.isPart,
});
/** a part's own pass marks, scale and Optional go: the subject's are for the total */
const asPart = { isPart: true, pass: '', scaleId: '', optional: false };
const hundredths = (v: string) => Math.round(Number(v) * 100);
/** the list as shown: each part line right under its subject (with its index in the list) */
function underParents<T extends { subjectId: string; parentId: string | null; isPart: boolean }>(
  ls: T[],
): Array<{ l: T; i: number }> {
  const part = (l: T) => l.isPart && ls.some((p) => p.subjectId === l.parentId && !p.isPart);
  return ls.flatMap((l, i) =>
    part(l)
      ? []
      : [
          { l, i },
          ...ls.flatMap((k, j) => (part(k) && k.parentId === l.subjectId ? [{ l: k, i: j }] : [])),
        ],
  );
}

/**
 * An exam type's subjects for a class (docs/design/70): each subject's maximum and pass marks, its
 * grade scale (a maximum of 0 makes it grade-only) and Optional; one maximum and pass applied to all;
 * a subject of the class added or removed; saved as a whole. A list not set yet starts from the
 * subjects the class studies, in its order. A sub-subject (Geography under Social Science) is a paper
 * of its own or, ticked "Part of", a part of its subject: exams then enter the subject in those parts,
 * which add up to its maximum.
 */
export function SubjectMarksEditor({
  typeId,
  classId,
  title,
  initial,
  studied,
  scales,
  canManage,
}: {
  typeId: string;
  classId: string;
  title: string;
  initial: SubjectMarksRow[];
  studied: Array<{
    id: string;
    code: string;
    name: string;
    elective: boolean;
    parentId: string | null;
  }>;
  scales: Array<{ id: string; code: string; name: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const fresh = initial.length === 0;
  const [lines, setLines] = useState<Line[]>(
    fresh
      ? studied.map((x) => ({
          subjectId: x.id,
          code: x.code,
          name: x.name,
          max: '',
          pass: '',
          scaleId: '',
          optional: x.elective,
          parentId: x.parentId,
          isPart: false,
        }))
      : initial.map(lineOf),
  );
  const [dirty, setDirty] = useState(false);
  const [allMax, setAllMax] = useState('');
  const [allPass, setAllPass] = useState('');
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (i: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
    setMsg(null);
  };
  // a part line needs its subject in the list as a paper; else it is a paper of its own
  const parentOf = (l: Line) =>
    l.parentId ? lines.find((p) => p.subjectId === l.parentId && !p.isPart) : undefined;
  const partOf = (l: Line) => (l.isPart ? parentOf(l) : undefined);
  /** each subject with parts: its maximum and theirs */
  const splits = lines
    .map((p) => ({ p, parts: lines.filter((x) => partOf(x) === p) }))
    .filter((x) => x.parts.length > 0)
    .map((x) => ({
      ...x,
      sum: x.parts.reduce((a, l) => a + hundredths(l.max), 0) / 100,
    }));
  /** sub-subjects that add up to their subject, not ticked yet: offered as its parts */
  const offers = lines
    .filter((p) => !p.isPart && Number(p.max) > 0)
    .map((p) => ({
      p,
      kids: lines.filter(
        (x) => x.parentId === p.subjectId && !x.isPart && x.subjectId !== p.subjectId,
      ),
    }))
    .filter(
      ({ p, kids }) =>
        kids.length > 1 &&
        !lines.some((x) => partOf(x) === p) &&
        kids.reduce((a, l) => a + hundredths(l.max), 0) === hundredths(p.max),
    );
  const problems = lines.flatMap((l) => {
    if (partOf(l))
      return l.max === '' || !(Number(l.max) > 0) ? [`${l.code}: give the part its maximum`] : [];
    const max = Number(l.max);
    const pass = l.pass === '' ? null : Number(l.pass);
    if (l.max === '' || !Number.isFinite(max) || max < 0)
      return [`${l.code}: give the maximum marks (0 for a graded subject)`];
    if (max === 0 && !l.scaleId) return [`${l.code}: a subject with no marks needs a grade scale`];
    if (max === 0 && pass !== null) return [`${l.code}: a graded subject has no pass marks`];
    if (pass !== null && (!Number.isFinite(pass) || pass < 0 || pass > max))
      return [`${l.code}: the pass marks must be between 0 and the maximum`];
    const split = splits.find((x) => x.p === l);
    if (split && split.sum !== max)
      return [`${l.code}: its parts add up to ${String(split.sum)}, not its maximum of ${l.max}`];
    return [];
  });
  const save = () => {
    if (problems.length) {
      setMsg({ tone: 'danger', text: `To fix first: ${problems.slice(0, 5).join('; ')}` });
      return;
    }
    start(async () => {
      const r = await saveSubjectMarks({
        typeId,
        classId,
        rows: lines.map((l) =>
          partOf(l)
            ? {
                subjectId: l.subjectId,
                max: Number(l.max),
                pass: null,
                scaleId: null,
                optional: false,
                isPart: true,
              }
            : {
                subjectId: l.subjectId,
                max: Number(l.max),
                pass: l.pass === '' ? null : Number(l.pass),
                scaleId: l.scaleId || null,
                optional: l.optional,
                isPart: false,
              },
        ),
      });
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      setLines(r.data.rows.map(lineOf));
      setDirty(false);
      setMsg({ tone: 'success', text: `Saved: ${String(r.data.rows.length)} subject(s)` });
      router.refresh();
    });
  };
  const addable = studied.filter((x) => !lines.some((l) => l.subjectId === x.id));

  if (!canManage)
    return (
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={title}>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Max marks</th>
              <th scope="col">Pass marks</th>
              <th scope="col">Grade scale</th>
              <th scope="col">Optional</th>
              <th scope="col">Part of</th>
            </tr>
          </thead>
          <tbody>
            {underParents(initial).map(({ l: r }) => (
              <tr key={r.subjectId}>
                <th scope="row" className={r.isPart ? 'ep-smparts__part' : undefined}>
                  {r.name} ({r.code})
                </th>
                <td>{r.max === 0 ? 'Grade only' : r.max}</td>
                <td>{r.pass ?? ''}</td>
                <td>{r.scaleCode ?? ''}</td>
                <td>{r.optional ? 'Yes' : ''}</td>
                <td>
                  {r.isPart ? (initial.find((p) => p.subjectId === r.parentId)?.code ?? '') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="ep-streg-form">
      {fresh ? (
        <p className="ep-alert ep-alert--info" style={{ margin: 0 }}>
          Not set yet: the subjects the class studies are listed. Give each its marks and Save, or
          use Fill from an exam below.
        </p>
      ) : null}
      <div className="ep-mr-toolbar">
        <label className="ep-field" style={{ margin: 0, width: '9rem' }}>
          <span className="ep-field__label">Max for all</span>
          <input
            className="ep-input"
            type="number"
            min={0}
            step="0.5"
            value={allMax}
            onChange={(e) => setAllMax(e.target.value)}
          />
        </label>
        <label className="ep-field" style={{ margin: 0, width: '9rem' }}>
          <span className="ep-field__label">Pass for all</span>
          <input
            className="ep-input"
            type="number"
            min={0}
            step="0.5"
            value={allPass}
            onChange={(e) => setAllPass(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={allMax === '' && allPass === ''}
          onClick={() => {
            // a graded subject (maximum 0) keeps its 0 and has no pass marks
            setLines((ls) =>
              ls.map((l) =>
                l.max === '0' || partOf(l)
                  ? l
                  : {
                      ...l,
                      ...(allMax !== '' ? { max: allMax } : {}),
                      ...(allPass !== '' ? { pass: allPass } : {}),
                    },
              ),
            );
            setDirty(true);
          }}
        >
          Apply to the subjects with marks (not parts)
        </Button>
      </div>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={title}>
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Max marks</th>
              <th scope="col">Pass marks</th>
              <th scope="col">Grade scale</th>
              <th scope="col">Optional</th>
              <th scope="col">Part of</th>
              <th scope="col">
                <span className="ep-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {underParents(lines).map(({ l, i }) => {
              const parent = parentOf(l);
              const part = l.isPart && !!parent;
              return (
                <tr key={l.subjectId}>
                  <th scope="row" className={part ? 'ep-smparts__part' : undefined}>
                    {l.name} ({l.code})
                  </th>
                  <td>
                    <input
                      className="ep-input"
                      style={{ width: '6.5rem' }}
                      type="number"
                      min={0}
                      step="0.5"
                      aria-label={`Max marks of ${l.name}`}
                      value={l.max}
                      onChange={(e) => change(i, { max: e.target.value })}
                    />
                  </td>
                  {part ? (
                    <td colSpan={3}>
                      <span className="ep-mr-col__desc">
                        {parent.code}’s pass marks, scale and Optional
                      </span>
                    </td>
                  ) : (
                    <>
                      <td>
                        <input
                          className="ep-input"
                          style={{ width: '6.5rem' }}
                          type="number"
                          min={0}
                          step="0.5"
                          aria-label={`Pass marks of ${l.name}`}
                          value={l.pass}
                          disabled={l.max === '0'}
                          onChange={(e) => change(i, { pass: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="ep-select"
                          data-native
                          aria-label={`Grade scale of ${l.name}`}
                          value={l.scaleId}
                          onChange={(e) => change(i, { scaleId: e.target.value })}
                        >
                          <option value="">
                            {l.max === '0' ? 'Choose the scale' : 'The class’s scale'}
                          </option>
                          {scales.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.code} · {g.name}
                            </option>
                          ))}
                        </select>
                        {l.max === '0' ? <span className="ep-mr-col__desc">Grade only</span> : null}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${l.name} is optional`}
                          checked={l.optional}
                          onChange={(e) => change(i, { optional: e.target.checked })}
                        />
                      </td>
                    </>
                  )}
                  <td>
                    {parent ? (
                      <label className="ep-smparts__tick">
                        <input
                          type="checkbox"
                          checked={l.isPart}
                          onChange={(e) => change(i, e.target.checked ? asPart : { isPart: false })}
                        />
                        <span>
                          <span className="ep-sr-only">{l.name} is a part of </span>
                          {parent.code}
                        </span>
                      </label>
                    ) : null}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setLines((ls) => ls.filter((_, j) => j !== i));
                        setDirty(true);
                      }}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {splits.length || offers.length ? (
        <div className="ep-smparts">
          {splits.map(({ p, parts, sum }) => (
            <p
              key={p.subjectId}
              className={sum === Number(p.max) ? 'ep-field__help' : 'ep-field__error'}
              style={{ margin: 0 }}
            >
              {p.name} {p.max} = {parts.map((x) => `${x.name} ${x.max || '?'}`).join(' + ')}
              {sum === Number(p.max)
                ? ' · entered in these parts, each by its teacher'
                : ` · ${String(sum)}: the parts must add up to ${p.max}`}
            </p>
          ))}
          {offers.map(({ p, kids }) => (
            <div key={p.subjectId} className="ep-alert ep-alert--info ep-smparts__offer">
              <span>
                {kids.map((k) => `${k.name} ${k.max}`).join(' + ')} = {p.name} {p.max}. Are they its
                parts, entered by their teachers, rather than papers of their own?
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const ids = new Set(kids.map((k) => k.subjectId));
                  setLines((ls) => ls.map((l) => (ids.has(l.subjectId) ? { ...l, ...asPart } : l)));
                  setDirty(true);
                  setMsg(null);
                }}
              >
                Make them parts of {p.name}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="ep-mr-toolbar">
        {addable.length ? (
          <>
            <label className="ep-field" style={{ margin: 0, minWidth: '16rem' }}>
              <span className="ep-field__label">Add a subject of the class</span>
              <select className="ep-select" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a subject</option>
                {addable.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!pick}
              onClick={() => {
                const x = studied.find((y) => y.id === pick);
                if (x)
                  setLines((ls) => [
                    ...ls,
                    {
                      subjectId: x.id,
                      code: x.code,
                      name: x.name,
                      max: '',
                      pass: '',
                      scaleId: '',
                      optional: x.elective,
                      parentId: x.parentId,
                      isPart: false,
                    },
                  ]);
                setPick('');
                setDirty(true);
              }}
            >
              Add
            </Button>
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <Button onClick={save} loading={pending}>
          Save {title}
        </Button>
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : dirty ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          Changes not saved yet.
        </p>
      ) : null}
    </div>
  );
}
