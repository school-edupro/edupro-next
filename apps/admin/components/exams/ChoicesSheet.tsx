'use client';
import { Button } from '@edupro/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** the student's own additional subject(s) (the old "Opt"): kept out of the total */
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

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const same = (a: Value, b: Value) =>
  a.stream === b.stream && sameSet(a.ids, b.ids) && sameSet(a.add, b.add);

/**
 * A section's subject choices (docs/design/67): the compulsory subjects come with every choice, a column
 * per choice group (one drop-down, or ticks when a group takes more than one), the stream (it ticks its
 * subjects), the other electives as ticks, and the student's own additional subject (the old "Opt").
 * Each row says what is missing, clears back to "not set" and opens its history; "Set many at once"
 * fills a column; counts follow as you go; one Save sends the rows that changed and asks before
 * leaving unsaved.
 */
export function ChoicesSheet({
  classSectionId,
  subjects,
  groups,
  streams,
  rows,
  canEdit,
  initialQuery = '',
  historyBase,
}: {
  classSectionId: string;
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
  const free = useMemo(() => subjects.filter((x) => x.take === 'free'), [subjects]);
  const code = (id: string) => subjects.find((x) => x.id === id)?.code ?? '';
  const nameOf = (id: string) => {
    const x = subjects.find((s) => s.id === id);
    return x ? `${x.name} (${x.code})` : '';
  };
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
  const [ticked, setTicked] = useState<string[]>([]);
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

  /** a change to one student: the compulsory subjects come with it */
  const edit = (r: ChoiceRow, fn: (v: Value) => Value) =>
    setValues((all) => {
      const next = fn(all[r.studentId]!);
      const ids = new Set(next.ids);
      if (ids.size || next.stream) for (const x of compulsory) ids.add(x.id);
      // a subject with marks stays
      if (ids.size) for (const id of r.marked) ids.add(id);
      return {
        ...all,
        [r.studentId]: {
          stream: next.stream,
          ids: [...ids],
          add: next.add.filter((id) => ids.has(id) && !compulsory.some((x) => x.id === id)),
        },
      };
    });
  /** back to "not set": the student takes every subject (a subject with marks keeps them anyway) */
  const clear = (r: ChoiceRow) =>
    setValues((all) => ({ ...all, [r.studentId]: { stream: '', ids: [], add: [] } }));
  /** what may be the student's own additional subject: one taken that is not compulsory or additional already */
  const optable = (v: Value) =>
    v.ids.filter((id) => {
      const x = subjects.find((s) => s.id === id);
      if (!x || x.take === 'all') return false;
      return !(x.take === 'group' && groups.find((g) => g.id === x.groupId)?.kind === 'additional');
    });
  const showOpt = subjects.some((x) => x.take !== 'all');
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
  const setGroup = (r: ChoiceRow, g: ChoiceGroup, id: string) =>
    edit(r, (v) => ({
      stream: v.stream,
      ids: [...v.ids.filter((x) => !g.subjectIds.includes(x) || marked(r, x)), ...(id ? [id] : [])],
      add: v.add,
    }));
  const toggle = (r: ChoiceRow, id: string, on: boolean) =>
    edit(r, (v) => ({
      stream: v.stream,
      ids: on ? [...v.ids, id] : v.ids.filter((x) => x !== id || marked(r, x)),
      add: v.add,
    }));
  const setOpt = (r: ChoiceRow, id: string) =>
    edit(r, (v) => ({ stream: v.stream, ids: v.ids, add: id ? [id] : [] }));

  // ---- bulk: one column for many students -------------------------------------------------------
  const targets = [
    ...(streams.length ? [{ key: 'stream', label: 'Stream' }] : []),
    ...groups.filter((g) => g.max === 1).map((g) => ({ key: `g:${g.id}`, label: g.name })),
    ...free.map((x) => ({ key: `f:${x.id}`, label: `${x.name} (${x.code})` })),
  ];
  const [target, setTarget] = useState(targets[0]?.key ?? '');
  const [choice, setChoice] = useState('');
  const [scope, setScope] = useState<'empty' | 'all' | 'ticked'>('empty');
  const options = (key: string): Array<[string, string]> => {
    if (key === 'stream') return streams.map((s) => [s.name, s.name]);
    if (key.startsWith('g:'))
      return (groups.find((g) => `g:${g.id}` === key)?.subjectIds ?? []).map((id) => [
        id,
        nameOf(id),
      ]);
    if (key.startsWith('f:'))
      return [
        ['yes', 'Takes it'],
        ['no', 'Does not take it'],
      ];
    return [];
  };
  const empty = (v: Value, key: string) => {
    if (key === 'stream') return !v.stream;
    if (key.startsWith('g:')) {
      const g = groups.find((x) => `g:${x.id}` === key)!;
      return !g.subjectIds.some((id) => v.ids.includes(id));
    }
    return !v.ids.includes(key.slice(2));
  };
  const apply = () => {
    const value = choice || options(target)[0]?.[0] || '';
    if (!target || !value) return;
    for (const r of rows) {
      const v = values[r.studentId]!;
      if (scope === 'ticked' && !ticked.includes(r.studentId)) continue;
      if (scope === 'empty' && !empty(v, target)) continue;
      if (target === 'stream') setStream(r, value);
      else if (target.startsWith('g:'))
        setGroup(
          r,
          groups.find((g) => `g:${g.id}` === target)!,
          value,
        );
      else toggle(r, target.slice(2), value === 'yes');
    }
  };

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
    .map((x) => ({
      x,
      n: rows.filter((r) => values[r.studentId]!.ids.includes(x.id)).length,
    }));
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
    if (!isSet(v)) return <span className="ep-kicker">Not set: takes every subject</span>;
    const m = missing(v);
    return m.length ? (
      <span className="ep-field__error">Missing: {m.map((g) => g.name).join(', ')}</span>
    ) : (
      <span className="ep-kicker">Complete</span>
    );
  };

  return (
    <div>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {compulsory.length ? (
          <>
            <strong>Everyone takes</strong> {compulsory.map((x) => x.code).join(' · ')}.{' '}
          </>
        ) : null}
        {[
          streams.length ? 'Choose the stream (it ticks its subjects)' : '',
          groups.length ? 'pick each group’s subject' : '',
          free.length ? 'tick the other subjects taken' : '',
        ]
          .filter(Boolean)
          .join(', ')
          .replace(/^./, (c) => c.toUpperCase())}
        {streams.length || groups.length || free.length
          ? '; the compulsory subjects come with the first choice. '
          : ''}
        A subject with marks this year stays (mark it NA on the marks sheet first).
      </p>
      {counts.length ? (
        <p className="ep-field__help" aria-live="polite">
          <strong>Chosen so far:</strong>{' '}
          {counts.map((c) => `${c.x.code} ${String(c.n)}`).join(' · ')}
        </p>
      ) : null}

      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <div role="group" aria-label="Show" className="ep-xchips">
          {(
            [
              ['all', `All ${String(rows.length)}`],
              ['missing', `Missing a choice ${String(nMissing)}`],
              ['unset', `Not set ${String(nUnset)}`],
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
        <label className="ep-field" style={{ minWidth: '14rem' }}>
          <span className="ep-field__label">Find a student</span>
          <input
            className="ep-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, admission or roll no"
          />
        </label>
      </div>

      {canEdit && targets.length ? (
        <fieldset
          className="ep-card"
          style={{ marginBottom: 'var(--sp-3)', padding: 'var(--sp-3)' }}
        >
          <legend className="ep-field__label">Set many at once</legend>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <label className="ep-field">
              <span className="ep-field__label">Column</span>
              <select
                className="ep-select"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setChoice('');
                }}
              >
                {targets.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">To</span>
              <select
                className="ep-select"
                value={choice || options(target)[0]?.[0] || ''}
                onChange={(e) => setChoice(e.target.value)}
              >
                {options(target).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">For</span>
              <select
                className="ep-select"
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                <option value="empty">Only those without one</option>
                <option value="all">Every student</option>
                <option value="ticked">The students ticked ({ticked.length})</option>
              </select>
            </label>
            <Button type="button" variant="secondary" onClick={apply}>
              Apply
            </Button>
          </div>
        </fieldset>
      ) : null}

      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Subject choices">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Subject choices</caption>
          <thead>
            <tr>
              {canEdit ? (
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Tick every student shown"
                    checked={shown.length > 0 && shown.every((r) => ticked.includes(r.studentId))}
                    onChange={(e) =>
                      setTicked(e.target.checked ? shown.map((r) => r.studentId) : [])
                    }
                  />
                </th>
              ) : null}
              <th scope="col">Roll</th>
              <th scope="col">Student</th>
              {showStream ? <th scope="col">Stream</th> : null}
              {groups.map((g) => (
                <th key={g.id} scope="col">
                  {g.name}
                  <span className="ep-kicker" style={{ display: 'block' }}>
                    {g.kind === 'additional' ? 'additional, ' : ''}pick{' '}
                    {g.min === g.max ? g.max : `${String(g.min)}–${String(g.max)}`}
                  </span>
                </th>
              ))}
              {free.length ? <th scope="col">Other subjects</th> : null}
              {showOpt ? (
                <th scope="col">
                  Opt
                  <span className="ep-kicker" style={{ display: 'block' }}>
                    additional, out of total
                  </span>
                </th>
              ) : null}
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = values[r.studentId]!;
              return (
                <tr key={r.studentId}>
                  {canEdit ? (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Tick ${r.name}`}
                        checked={ticked.includes(r.studentId)}
                        onChange={(e) =>
                          setTicked((t) =>
                            e.target.checked
                              ? [...t, r.studentId]
                              : t.filter((x) => x !== r.studentId),
                          )
                        }
                      />
                    </td>
                  ) : null}
                  <td>{r.rollNo ?? ''}</td>
                  <th scope="row">
                    {r.name}
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {r.admissionNo}
                    </span>
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
                          <option value="">-</option>
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
                  {groups.map((g) => {
                    const chosen = g.subjectIds.filter((id) => v.ids.includes(id));
                    if (g.max === 1) {
                      const locked = chosen.some((id) => marked(r, id));
                      return (
                        <td key={g.id}>
                          <select
                            className="ep-select"
                            aria-label={`${g.name} · ${r.name}`}
                            value={chosen[0] ?? ''}
                            disabled={!canEdit || locked}
                            title={locked ? 'Has marks this year' : undefined}
                            onChange={(e) => setGroup(r, g, e.target.value)}
                          >
                            <option value="">-</option>
                            {g.subjectIds.map((id) => (
                              <option key={id} value={id}>
                                {nameOf(id)}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    return (
                      <td key={g.id}>
                        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                          <legend className="ep-sr-only">{`${g.name} · ${r.name}`}</legend>
                          {g.subjectIds.map((id) => (
                            <label key={id} style={{ marginRight: 'var(--sp-2)' }}>
                              <input
                                type="checkbox"
                                checked={v.ids.includes(id)}
                                disabled={!canEdit || (v.ids.includes(id) && marked(r, id))}
                                onChange={(e) => toggle(r, id, e.target.checked)}
                              />{' '}
                              <abbr title={nameOf(id)}>{code(id)}</abbr>
                            </label>
                          ))}
                        </fieldset>
                      </td>
                    );
                  })}
                  {free.length ? (
                    <td>
                      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                        <legend className="ep-sr-only">{`Other subjects · ${r.name}`}</legend>
                        {free.map((x) => (
                          <label key={x.id} style={{ marginRight: 'var(--sp-2)' }}>
                            <input
                              type="checkbox"
                              checked={v.ids.includes(x.id)}
                              disabled={!canEdit || (v.ids.includes(x.id) && marked(r, x.id))}
                              onChange={(e) => toggle(r, x.id, e.target.checked)}
                            />{' '}
                            <abbr title={x.name}>{x.code}</abbr>
                          </label>
                        ))}
                      </fieldset>
                    </td>
                  ) : null}
                  {showOpt ? (
                    <td>
                      <select
                        className="ep-select"
                        aria-label={`Opt (additional subject) · ${r.name}`}
                        value={v.add[0] ?? ''}
                        disabled={!canEdit || !optable(v).length}
                        onChange={(e) => setOpt(r, e.target.value)}
                      >
                        <option value="">-</option>
                        {optable(v).map((id) => (
                          <option key={id} value={id}>
                            {nameOf(id)}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  <td>
                    {status(v)}
                    <span
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        alignItems: 'center',
                        marginTop: 'var(--sp-1)',
                      }}
                    >
                      {canEdit && isSet(v) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Clear ${r.name}'s choices`}
                          onClick={() => clear(r)}
                        >
                          Clear
                        </Button>
                      ) : null}
                      <a href={`${historyBase}${r.studentId}`} aria-label={`History of ${r.name}`}>
                        History
                      </a>
                    </span>
                  </td>
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
