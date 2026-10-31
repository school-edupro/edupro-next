'use client';
import { Button } from '@edupro/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/nav-icons';
import { saveChoicesSheet } from '@/lib/exam-entry-actions';

export interface ChoiceSubject {
  id: string;
  code: string;
  name: string;
  take: 'all' | 'group' | 'free';
  groupId: string | null;
  /** its sub-subjects in the subject master, and those it is entered in (Class set-up) */
  children?: Array<{ id: string; code: string; name: string }>;
  parts?: Array<{ subjectId: string; code: string; name: string; share: number }>;
}
export interface ChoiceGroup {
  id: string;
  name: string;
  kind: 'optional' | 'additional';
  min: number;
  max: number;
  subjectIds: string[];
}
export interface ChoiceStream {
  id: string;
  name: string;
  subjectIds: string[];
}
export interface ChoiceRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  stream: string | null;
  subjectIds: string[];
  /** the student's own additional subject(s) (the old "Optional" tick): kept out of the total */
  additionalIds: string[];
  /** subjects with marks this year: not taken off */
  marked: string[];
}
interface Value {
  stream: string;
  ids: string[];
  /** taken as additional by the student's own choice */
  add: string[];
}
type Filter = 'all' | 'missing' | 'unset';
/**
 * One column of the grid: Subject-1, Subject-2, … in the class's order. A subject everyone takes, one
 * pick of a choice group (a group that takes two has two), or an elective (taken or not).
 */
type Slot =
  | { kind: 'all'; id: string }
  | { kind: 'group'; group: ChoiceGroup; pick: number }
  | { kind: 'free'; id: string };

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const same = (a: Value, b: Value) =>
  a.stream === b.stream && sameSet(a.ids, b.ids) && sameSet(a.add, b.add);

/**
 * A section's subject choices laid out like the legacy Student Subject Mapping (docs/design/67): a row
 * per student with the stream and Subject-1, Subject-2, … in the class's order, each a drop-down with an
 * "Optional" tick (the student's own additional subject, kept out of the total) and, for a subject
 * entered in parts, its sub-subjects; "Bulk assign all" on a column's heading sets it for every student;
 * the bin clears a row back to "not set". Changes collect on screen and one Save sends them (asks
 * before leaving unsaved).
 */
export function ChoicesSheet({
  classSectionId,
  sectionCode,
  subjects,
  groups,
  streams,
  rows,
  canEdit,
  initialQuery = '',
  historyBase,
}: {
  classSectionId: string;
  sectionCode: string;
  subjects: ChoiceSubject[];
  groups: ChoiceGroup[];
  streams: ChoiceStream[];
  rows: ChoiceRow[];
  canEdit: boolean;
  /** a student looked up by admission no: the grid opens filtered to them */
  initialQuery?: string;
  /** the address that opens a student's history, the student id appended */
  historyBase: string;
}) {
  const leaving = useRef(false);
  const compulsory = useMemo(() => subjects.filter((x) => x.take === 'all'), [subjects]);
  const byId = useMemo(() => new Map(subjects.map((x) => [x.id, x])), [subjects]);
  const nameOf = (id: string) => byId.get(id)?.name ?? '';
  // the columns, in the class's order: a group at its first subject's place
  const slots = useMemo(() => {
    const out: Slot[] = [];
    for (const x of subjects) {
      if (x.take === 'all') out.push({ kind: 'all', id: x.id });
      else if (x.take === 'free') out.push({ kind: 'free', id: x.id });
      else {
        const g = groups.find((y) => y.id === x.groupId);
        if (g && !out.some((s) => s.kind === 'group' && s.group.id === g.id))
          for (let i = 0; i < g.max; i += 1) out.push({ kind: 'group', group: g, pick: i });
      }
    }
    return out;
  }, [subjects, groups]);
  const initial = useMemo(
    () =>
      Object.fromEntries(
        rows.map((r) => [
          r.studentId,
          { stream: r.stream ?? '', ids: r.subjectIds, add: r.additionalIds },
        ]),
      ) as Record<string, Value>,
    [rows],
  );
  const [values, setValues] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showStream = streams.length > 0 || rows.some((r) => r.stream);
  const changed = rows.filter((r) => !same(values[r.studentId]!, initial[r.studentId]!));
  const dirty = changed.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const marked = (r: ChoiceRow, id: string) => r.marked.includes(id);
  const isSet = (v: Value) => v.ids.length > 0 || v.stream !== '';
  const missing = (v: Value) =>
    isSet(v)
      ? groups.filter((g) => g.subjectIds.filter((id) => v.ids.includes(id)).length < g.min)
      : [];
  /** an additional group's subjects are additional anyway: no tick of their own */
  const additionalGroup = (id: string) => {
    const x = byId.get(id);
    return x?.take === 'group' && groups.find((g) => g.id === x.groupId)?.kind === 'additional';
  };

  /** a change to one student: the compulsory subjects come with it, a subject with marks stays */
  const edit = (r: ChoiceRow, fn: (v: Value) => Value) =>
    setValues((all) => {
      const next = fn(all[r.studentId]!);
      const ids = new Set(next.ids);
      if (ids.size || next.stream) for (const x of compulsory) ids.add(x.id);
      if (ids.size) for (const id of r.marked) ids.add(id);
      return {
        ...all,
        [r.studentId]: {
          stream: next.stream,
          ids: [...ids],
          add: next.add.filter((id) => ids.has(id) && byId.get(id)?.take !== 'all'),
        },
      };
    });
  /** back to "not set": the student takes every subject (a subject with marks keeps them anyway) */
  const clear = (r: ChoiceRow) =>
    setValues((all) => ({ ...all, [r.studentId]: { stream: '', ids: [], add: [] } }));
  const setStream = (r: ChoiceRow, name: string) =>
    edit(r, (v) => {
      const old = streams.find((s) => s.name === v.stream)?.subjectIds ?? [];
      const add = streams.find((s) => s.name === name)?.subjectIds ?? [];
      return {
        stream: name,
        ids: [...v.ids.filter((id) => !old.includes(id)), ...add],
        add: v.add,
      };
    });
  /** the subject in a slot for a student */
  const inSlot = (v: Value, s: Slot): string => {
    if (s.kind !== 'group') return v.ids.includes(s.id) ? s.id : '';
    return s.group.subjectIds.filter((id) => v.ids.includes(id))[s.pick] ?? '';
  };
  const setSlot = (r: ChoiceRow, s: Slot, id: string) =>
    edit(r, (v) => {
      if (s.kind === 'free')
        return {
          ...v,
          ids: id ? [...v.ids, s.id] : v.ids.filter((x) => x !== s.id || marked(r, x)),
        };
      if (s.kind === 'all') return { ...v, ids: [...v.ids, s.id] };
      const old = inSlot(v, s);
      if (old && marked(r, old)) return v;
      const ids = v.ids.filter((x) => x !== old && x !== id);
      return { ...v, ids: id ? [...ids, id] : ids };
    });
  const setOptional = (r: ChoiceRow, id: string, on: boolean) =>
    edit(r, (v) => ({
      ...v,
      add: on ? [...v.add.filter((x) => x !== id), id] : v.add.filter((x) => x !== id),
    }));
  /** "Bulk assign all": the column for every student of the section */
  const bulk = (s: Slot, id: string) => {
    for (const r of rows) setSlot(r, s, id);
  };
  const bulkStream = (name: string) => {
    for (const r of rows) setStream(r, name);
  };
  const optionsOf = (s: Slot): string[] => (s.kind === 'group' ? s.group.subjectIds : [s.id]);

  // ---- filter and counts ------------------------------------------------------------------------
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    const v = values[r.studentId]!;
    if (filter === 'missing' && !missing(v).length) return false;
    if (filter === 'unset' && isSet(v)) return false;
    return (
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.admissionNo.toLowerCase().includes(q) ||
      String(r.rollNo ?? '') === q
    );
  });
  const counts = subjects
    .filter((x) => x.take !== 'all')
    .map((x) => ({ x, n: rows.filter((r) => values[r.studentId]!.ids.includes(x.id)).length }));
  const nMissing = rows.filter((r) => missing(values[r.studentId]!).length).length;
  const nUnset = rows.filter((r) => !isSet(values[r.studentId]!)).length;

  const save = async () => {
    setError(null);
    setBusy(true);
    const r = await saveChoicesSheet(
      classSectionId,
      changed.map((x) => ({
        studentId: x.studentId,
        stream: values[x.studentId]!.stream || null,
        subjectIds: values[x.studentId]!.ids,
        additionalIds: values[x.studentId]!.add,
      })),
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    leaving.current = true;
    const url = new URL(window.location.href);
    for (const k of ['error', 'detail']) url.searchParams.delete(k);
    url.searchParams.set('ok', '1');
    window.location.assign(url.toString());
  };

  const status = (v: Value) => {
    if (!isSet(v))
      return (
        <span className="ep-kicker" style={{ display: 'block' }}>
          Not set: takes every subject
        </span>
      );
    const m = missing(v);
    return m.length ? (
      <span className="ep-field__error" style={{ display: 'block' }}>
        Missing: {m.map((g) => g.name).join(', ')}
      </span>
    ) : null;
  };
  const slotTitle = (s: Slot) =>
    s.kind === 'group'
      ? `${s.group.name}${s.group.max > 1 ? ` (${String(s.pick + 1)})` : ''}`
      : s.kind === 'all'
        ? 'Everyone'
        : 'Elective';

  return (
    <div className="ep-subchoice">
      <div className="ep-subchoice__tools">
        <div role="group" aria-label="Show" className="ep-xchips">
          {(
            [
              ['all', `All students (${String(rows.length)})`],
              ['missing', `Missing a choice (${String(nMissing)})`],
              ['unset', `Not set (${String(nUnset)})`],
            ] as Array<[Filter, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="ep-xlock"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ep-field" style={{ minWidth: '15rem' }}>
          <span className="ep-field__label">Find in {sectionCode}</span>
          <input
            className="ep-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, admission or roll no"
          />
        </label>
      </div>
      {counts.length ? (
        <p className="ep-field__help" aria-live="polite" style={{ marginTop: 0 }}>
          <strong>Taking:</strong> {counts.map((c) => `${c.x.code} ${String(c.n)}`).join(' · ')}
        </p>
      ) : null}

      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Subject choices">
        <table className="ep-table ep-subchoice__table">
          <caption className="ep-sr-only">
            Subject choices of {sectionCode}: Subject-1, Subject-2, … in the class&rsquo;s order
          </caption>
          <thead>
            <tr>
              <th scope="col">Sr no.</th>
              <th scope="col">Name</th>
              {showStream ? (
                <th scope="col">
                  Stream
                  {canEdit && streams.length ? (
                    <select
                      className="ep-select ep-subchoice__bulk"
                      aria-label="Bulk stream all"
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          bulkStream(e.target.value === '-' ? '' : e.target.value);
                      }}
                    >
                      <option value="">-- Bulk stream all --</option>
                      {streams.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                      <option value="-">No stream</option>
                    </select>
                  ) : null}
                </th>
              ) : null}
              {slots.map((s, k) => (
                <th key={k} scope="col">
                  Subject-{k + 1}
                  <span className="ep-kicker" style={{ display: 'block' }}>
                    {slotTitle(s)}
                  </span>
                  {canEdit && s.kind !== 'all' ? (
                    <select
                      className="ep-select ep-subchoice__bulk"
                      aria-label={`Bulk assign all: Subject-${String(k + 1)}`}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) bulk(s, e.target.value === '-' ? '' : e.target.value);
                      }}
                    >
                      <option value="">-- Bulk assign all --</option>
                      {optionsOf(s).map((id) => (
                        <option key={id} value={id}>
                          {nameOf(id)}
                        </option>
                      ))}
                      <option value="-">None</option>
                    </select>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const v = values[r.studentId]!;
              return (
                <tr key={r.studentId}>
                  <td>
                    <span className="ep-subchoice__srno">
                      {r.rollNo ?? i + 1}
                      {canEdit && isSet(v) ? (
                        <button
                          type="button"
                          className="ep-subchoice__icon"
                          aria-label={`Clear ${r.name}'s choices`}
                          title="Clear: back to not set"
                          onClick={() => clear(r)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      ) : null}
                      <a
                        className="ep-subchoice__icon"
                        href={`${historyBase}${r.studentId}`}
                        aria-label={`History of ${r.name}`}
                        title="History"
                      >
                        <Icon name="clock" size={16} />
                      </a>
                    </span>
                  </td>
                  <th scope="row">
                    <span className="ep-subchoice__name">{r.name}</span>
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {r.admissionNo}
                    </span>
                    {status(v)}
                  </th>
                  {showStream ? (
                    <td>
                      {streams.length ? (
                        <select
                          className="ep-select"
                          aria-label={`Stream · ${r.name}`}
                          value={v.stream}
                          disabled={!canEdit}
                          onChange={(e) => setStream(r, e.target.value)}
                        >
                          <option value="">Select stream</option>
                          {streams.map((s) => (
                            <option key={s.id} value={s.name}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        v.stream
                      )}
                    </td>
                  ) : null}
                  {slots.map((s, k) => {
                    const id = inSlot(v, s);
                    const sub = id ? byId.get(id) : undefined;
                    const locked = Boolean(id && marked(r, id));
                    const label = `Subject-${String(k + 1)} · ${r.name}`;
                    const optional = id ? v.add.includes(id) || additionalGroup(id) : false;
                    return (
                      <td key={k}>
                        {s.kind === 'all' ? (
                          <span
                            className="ep-subchoice__fixed"
                            title={isSet(v) ? 'Everyone takes it' : 'Not set: takes every subject'}
                          >
                            {nameOf(s.id)}
                          </span>
                        ) : (
                          <select
                            className="ep-select"
                            aria-label={label}
                            value={id}
                            disabled={!canEdit || locked}
                            title={locked ? 'Has marks this year' : undefined}
                            onChange={(e) => setSlot(r, s, e.target.value)}
                          >
                            <option value="">Select subject</option>
                            {optionsOf(s)
                              // a group's other slot keeps its own pick
                              .filter((o) => o === id || s.kind !== 'group' || !v.ids.includes(o))
                              .map((o) => (
                                <option key={o} value={o}>
                                  {nameOf(o)}
                                </option>
                              ))}
                          </select>
                        )}
                        {(s.kind === 'all' ? byId.get(s.id) : sub)?.parts?.length ? (
                          <span className="ep-subchoice__parts">
                            {(s.kind === 'all' ? byId.get(s.id) : sub)!.parts!.map((p) => (
                              <label key={p.subjectId} title="Set in Class set-up">
                                {p.name}
                                <input type="checkbox" checked readOnly disabled />
                              </label>
                            ))}
                          </span>
                        ) : null}
                        {s.kind !== 'all' ? (
                          <label
                            className="ep-subchoice__opt"
                            title="Kept out of the total, printed last"
                          >
                            Optional
                            <input
                              type="checkbox"
                              aria-label={`Optional (out of total) · ${label}`}
                              checked={optional}
                              disabled={!canEdit || !id || additionalGroup(id)}
                              onChange={(e) => setOptional(r, id, e.target.checked)}
                            />
                          </label>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!shown.length ? <p className="ep-field__help">No student matches.</p> : null}
      {canEdit ? (
        <div className="ep-savebar">
          <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
            {error ? (
              <span className="ep-field__error">{error}</span>
            ) : dirty ? (
              `${String(changed.length)} student${changed.length === 1 ? '' : 's'} changed, not saved yet`
            ) : (
              'Everything is saved'
            )}
          </p>
          <div className="ep-savebar__actions">
            <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save the choices'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
