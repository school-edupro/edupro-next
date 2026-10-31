'use client';
import { Button } from '@edupro/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveSubjectSetup, type SubjectSetupInput } from '@/lib/exam-entry-actions';
import type { ChoiceGroup, ChoiceStream, ChoiceSubject } from './ChoicesSheet';

interface Group {
  key: string;
  name: string;
  kind: 'optional' | 'additional';
  min: number;
  max: number;
}
interface Stream {
  key: string;
  name: string;
  ids: string[];
}
interface State {
  /** every subject in the order printed; a group's subjects print together, at its first one */
  order: string[];
  /** all, free, or a group's key */
  take: Record<string, string>;
  groups: Group[];
  streams: Stream[];
  /** a subject entered in parts: its sub-subjects with their share of the maximum */
  parts: Record<string, Array<{ subjectId: string; share: number }>>;
}
type Place = { kind: 's'; id: string } | { kind: 'g'; key: string; ids: string[] };

/** The places of the order: a subject on its own, or a group with its subjects. */
function placesOf(s: State): Place[] {
  const out: Place[] = [];
  for (const id of s.order) {
    const t = s.take[id]!;
    if (t === 'all' || t === 'free') out.push({ kind: 's', id });
    else {
      const g = out.find((p): p is Extract<Place, { kind: 'g' }> => p.kind === 'g' && p.key === t);
      if (g) g.ids.push(id);
      else out.push({ kind: 'g', key: t, ids: [id] });
    }
  }
  // a group with no subject yet keeps a place at the end
  for (const g of s.groups)
    if (!out.some((p) => p.kind === 'g' && p.key === g.key))
      out.push({ kind: 'g', key: g.key, ids: [] });
  return out;
}
const flatten = (places: Place[]) => places.flatMap((p) => (p.kind === 's' ? [p.id] : p.ids));

/**
 * A class's subjects for report cards and the register (docs/design/67): their order (a group prints
 * at its place, the subject the student took), who takes each (everyone, one of a choice group, anyone
 * who picks it), the choice groups (counted in the total or additional, how many to pick) and the
 * streams (a set of subjects). One Save; students' choices follow the change.
 */
export function ClassSubjectSetup({
  classId,
  subjects,
  groups,
  streams,
  canEdit,
}: {
  classId: string;
  subjects: ChoiceSubject[];
  groups: ChoiceGroup[];
  streams: ChoiceStream[];
  canEdit: boolean;
}) {
  const leaving = useRef(false);
  const initial = useMemo<State>(
    () => ({
      order: subjects.map((x) => x.id),
      take: Object.fromEntries(
        subjects.map((x) => [x.id, x.take === 'group' ? x.groupId! : x.take]),
      ),
      groups: groups.map((g) => ({
        key: g.id,
        name: g.name,
        kind: g.kind,
        min: g.min,
        max: g.max,
      })),
      streams: streams.map((s) => ({ key: s.id, name: s.name, ids: s.subjectIds })),
      parts: Object.fromEntries(
        subjects.map((x) => [
          x.id,
          (x.parts ?? []).map((p) => ({ subjectId: p.subjectId, share: p.share })),
        ]),
      ),
    }),
    [subjects, groups, streams],
  );
  const [s, set] = useState<State>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(1);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sub = (id: string) => subjects.find((x) => x.id === id)!;
  const label = (id: string) => `${sub(id).name} (${sub(id).code})`;
  const places = placesOf(s);
  const group = (key: string) => s.groups.find((g) => g.key === key);

  /** a place up or down the order */
  const movePlace = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= places.length) return;
    const next = [...places];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ ...s, order: flatten(next) });
  };
  /** a subject up or down inside its group */
  const moveInGroup = (ids: string[], k: number, by: -1 | 1) => {
    const a = ids[k]!;
    const b = ids[k + by];
    if (!b) return;
    const order = s.order.map((x) => (x === a ? b : x === b ? a : x));
    set({ ...s, order });
  };
  const setTake = (id: string, take: string) =>
    set({
      ...s,
      take: { ...s.take, [id]: take },
      // a subject everyone takes is in no stream
      streams:
        take === 'all'
          ? s.streams.map((x) => ({ ...x, ids: x.ids.filter((y) => y !== id) }))
          : s.streams,
    });
  const setGroup = (key: string, patch: Partial<Group>) =>
    set({ ...s, groups: s.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) });
  const addGroup = () => {
    setSeq(seq + 1);
    set({
      ...s,
      groups: [
        ...s.groups,
        {
          key: `new-${String(seq)}`,
          name: `Group ${String(s.groups.length + 1)}`,
          kind: 'optional',
          min: 1,
          max: 1,
        },
      ],
    });
  };
  const removeGroup = (key: string) =>
    set({
      ...s,
      groups: s.groups.filter((g) => g.key !== key),
      take: Object.fromEntries(
        Object.entries(s.take).map(([id, t]) => [id, t === key ? 'free' : t]),
      ),
    });
  const addStream = () => {
    setSeq(seq + 1);
    set({
      ...s,
      streams: [
        ...s.streams,
        { key: `new-${String(seq)}`, name: `Stream ${String(s.streams.length + 1)}`, ids: [] },
      ],
    });
  };
  const setStream = (key: string, patch: Partial<Stream>) =>
    set({ ...s, streams: s.streams.map((x) => (x.key === key ? { ...x, ...patch } : x)) });

  const problems = [
    ...s.groups
      .filter((g) => !Object.values(s.take).includes(g.key))
      .map((g) => `${g.name}: put at least one subject in it (Who takes it)`),
    ...s.groups
      .filter((g) => g.min > g.max)
      .map((g) => `${g.name}: “at least” is more than “at most”`),
    ...s.groups
      .filter((g) => g.max > Object.values(s.take).filter((t) => t === g.key).length)
      .filter((g) => Object.values(s.take).includes(g.key))
      .map((g) => `${g.name}: “at most” is more than its subjects`),
    ...s.streams.filter((x) => !x.ids.length).map((x) => `${x.name}: tick its subjects`),
  ];

  const save = async () => {
    setError(null);
    setBusy(true);
    const input: SubjectSetupInput = {
      classId,
      groups: s.groups.map((g) => ({ ...g, name: g.name.trim() })),
      subjects: s.order.map((id) => {
        const t = s.take[id]!;
        const parts = s.parts[id] ?? [];
        return t === 'all' || t === 'free'
          ? { subjectId: id, take: t, group: null, parts }
          : { subjectId: id, take: 'group' as const, group: t, parts };
      }),
      streams: s.streams.map((x) => ({ name: x.name.trim(), subjectIds: x.ids })),
    };
    const r = await saveSubjectSetup(input);
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

  /** the sub-subjects a subject is entered in (Social Science: Geography, History, Pol. Sc.) */
  const setPart = (id: string, kid: string, share: number | null) => {
    const cur = s.parts[id] ?? [];
    const next =
      share === null
        ? cur.filter((p) => p.subjectId !== kid)
        : cur.some((p) => p.subjectId === kid)
          ? cur.map((p) => (p.subjectId === kid ? { ...p, share } : p))
          : [...cur, { subjectId: kid, share }];
    set({ ...s, parts: { ...s.parts, [id]: next } });
  };
  const partsCell = (id: string) => {
    const kids = sub(id).children ?? [];
    if (!kids.length) return <span className="ep-kicker">-</span>;
    const mine = s.parts[id] ?? [];
    return (
      <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="ep-sr-only">{`${label(id)}: entered in parts`}</legend>
        {kids.map((k) => {
          const p = mine.find((x) => x.subjectId === k.id);
          return (
            <span
              key={k.id}
              style={{
                display: 'inline-flex',
                gap: 'var(--sp-1)',
                alignItems: 'center',
                marginRight: 'var(--sp-3)',
              }}
            >
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(p)}
                  disabled={!canEdit}
                  onChange={(e) => setPart(id, k.id, e.target.checked ? 1 : null)}
                />{' '}
                <abbr title={k.name}>{k.code}</abbr>
              </label>
              {p ? (
                <input
                  className="ep-input"
                  type="number"
                  min={0.5}
                  max={1000}
                  step={0.5}
                  aria-label={`${k.name}: share of ${sub(id).name}'s maximum`}
                  value={p.share}
                  disabled={!canEdit}
                  onChange={(e) => setPart(id, k.id, Math.max(0.5, Number(e.target.value) || 1))}
                  style={{ width: '4.5rem' }}
                />
              ) : null}
            </span>
          );
        })}
      </fieldset>
    );
  };
  const takeSelect = (id: string) => (
    <select
      className="ep-select"
      aria-label={`Who takes ${label(id)}`}
      value={s.take[id]}
      disabled={!canEdit}
      onChange={(e) => setTake(id, e.target.value)}
    >
      <option value="all">Everyone (compulsory)</option>
      <option value="free">Those who pick it (elective)</option>
      {s.groups.map((g) => (
        <option key={g.key} value={g.key}>
          One of: {g.name}
        </option>
      ))}
    </select>
  );
  const arrows = (name: string, up: () => void, down: () => void, first: boolean, last: boolean) =>
    canEdit ? (
      <span style={{ whiteSpace: 'nowrap' }}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={up}
          disabled={first}
          aria-label={`Move ${name} up`}
        >
          ↑
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={down}
          disabled={last}
          aria-label={`Move ${name} down`}
        >
          ↓
        </Button>
      </span>
    ) : null;

  let n = 0;
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Order on the report card and the register</h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The subjects print in this order, as Subject-1, Subject-2, … in the mark registers. A group
        prints at its place: each student&rsquo;s own subject from it. Additional subjects print
        last, marked. &ldquo;Entered in parts&rdquo;: a subject&rsquo;s sub-subjects (Social
        Science: Geography, History, Pol. Sc.), each entered by its own teacher; every exam of the
        class splits the subject&rsquo;s maximum by the shares (1, 1, 1 for equal parts, or the
        marks themselves, e.g. 27, 27, 26 out of 80). The registers show the parts; the report card
        the total.
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Order of the subjects">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Order of the subjects</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Subject</th>
              <th scope="col">Who takes it</th>
              <th scope="col">
                Entered in parts
                <span className="ep-kicker" style={{ display: 'block' }}>
                  sub-subject: share of the maximum
                </span>
              </th>
              {canEdit ? <th scope="col">Move</th> : null}
            </tr>
          </thead>
          <tbody>
            {places.flatMap((p, i) => {
              const first = i === 0;
              const last = i === places.length - 1;
              if (p.kind === 's') {
                n += 1;
                return [
                  <tr key={p.id}>
                    <td>{n}</td>
                    <th scope="row">{label(p.id)}</th>
                    <td>{takeSelect(p.id)}</td>
                    <td>{partsCell(p.id)}</td>
                    {canEdit ? (
                      <td>
                        {arrows(
                          label(p.id),
                          () => movePlace(i, -1),
                          () => movePlace(i, 1),
                          first,
                          last,
                        )}
                      </td>
                    ) : null}
                  </tr>,
                ];
              }
              const g = group(p.key);
              n += 1;
              const at = n;
              return [
                <tr key={`g-${p.key}`}>
                  <td>{at}</td>
                  <th scope="row" colSpan={3}>
                    {g?.name ?? ''}{' '}
                    <span className="ep-kicker">
                      {g?.kind === 'additional' ? 'additional, ' : ''}pick{' '}
                      {g && g.min === g.max ? g.max : `${String(g?.min)}–${String(g?.max)}`}
                      {p.ids.length ? '' : ' · no subject yet'}
                    </span>
                  </th>
                  {canEdit ? (
                    <td>
                      {arrows(
                        g?.name ?? '',
                        () => movePlace(i, -1),
                        () => movePlace(i, 1),
                        first,
                        last,
                      )}
                    </td>
                  ) : null}
                </tr>,
                ...p.ids.map((id, k) => (
                  <tr key={id}>
                    <td />
                    <td style={{ paddingLeft: 'var(--sp-5)' }}>{label(id)}</td>
                    <td>{takeSelect(id)}</td>
                    <td>{partsCell(id)}</td>
                    {canEdit ? (
                      <td>
                        {arrows(
                          label(id),
                          () => moveInGroup(p.ids, k, -1),
                          () => moveInGroup(p.ids, k, 1),
                          k === 0,
                          k === p.ids.length - 1,
                        )}
                      </td>
                    ) : null}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>

      <h3>Choice groups</h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        A group is a choice the student makes, such as &ldquo;Second language: Hindi, Sanskrit or
        French&rdquo;. Put subjects in it with &ldquo;Who takes it&rdquo; above.
      </p>
      {s.groups.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Choice groups">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Choice groups</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">In the total</th>
                <th scope="col">Pick at least</th>
                <th scope="col">Pick at most</th>
                <th scope="col">Subjects</th>
                {canEdit ? <th scope="col">Remove</th> : null}
              </tr>
            </thead>
            <tbody>
              {s.groups.map((g) => (
                <tr key={g.key}>
                  <td>
                    <input
                      className="ep-input"
                      aria-label="Group name"
                      value={g.name}
                      maxLength={60}
                      disabled={!canEdit}
                      onChange={(e) => setGroup(g.key, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`${g.name}: in the total`}
                      value={g.kind}
                      disabled={!canEdit}
                      onChange={(e) => setGroup(g.key, { kind: e.target.value as Group['kind'] })}
                    >
                      <option value="optional">Counts in the total</option>
                      <option value="additional">Additional (kept out)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={0}
                      max={10}
                      aria-label={`${g.name}: pick at least`}
                      value={g.min}
                      disabled={!canEdit}
                      onChange={(e) => setGroup(g.key, { min: Number(e.target.value) })}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={1}
                      max={10}
                      aria-label={`${g.name}: pick at most`}
                      value={g.max}
                      disabled={!canEdit}
                      onChange={(e) => setGroup(g.key, { max: Number(e.target.value) })}
                      style={{ width: '5rem' }}
                    />
                  </td>
                  <td>
                    {s.order
                      .filter((id) => s.take[id] === g.key)
                      .map((id) => sub(id).code)
                      .join(', ') || '-'}
                  </td>
                  {canEdit ? (
                    <td>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeGroup(g.key)}
                      >
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No choice groups: every elective is picked on its own.</p>
      )}
      {canEdit ? (
        <p>
          <Button type="button" variant="secondary" size="sm" onClick={addGroup}>
            Add a group
          </Button>
        </p>
      ) : null}

      <h3>Streams</h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        For classes XI and XII: a stream is a set of subjects (Science-PCM: Physics, Chemistry,
        Mathematics). Choosing a student&rsquo;s stream ticks its subjects.
      </p>
      {s.streams.map((x) => (
        <fieldset
          key={x.key}
          className="ep-card"
          style={{ marginBottom: 'var(--sp-3)', padding: 'var(--sp-3)' }}
        >
          <legend className="ep-sr-only">{x.name}</legend>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <label className="ep-field">
              <span className="ep-field__label">Stream</span>
              <input
                className="ep-input"
                value={x.name}
                maxLength={40}
                disabled={!canEdit}
                onChange={(e) => setStream(x.key, { name: e.target.value })}
              />
            </label>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set({ ...s, streams: s.streams.filter((y) => y.key !== x.key) })}
              >
                Remove {x.name}
              </Button>
            ) : null}
          </div>
          <div role="group" aria-label={`${x.name}: subjects`} style={{ marginTop: 'var(--sp-2)' }}>
            {s.order
              .filter((id) => s.take[id] !== 'all')
              .map((id) => (
                <label key={id} style={{ marginRight: 'var(--sp-3)', whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={x.ids.includes(id)}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setStream(x.key, {
                        ids: e.target.checked ? [...x.ids, id] : x.ids.filter((y) => y !== id),
                      })
                    }
                  />{' '}
                  {label(id)}
                </label>
              ))}
          </div>
        </fieldset>
      ))}
      {!s.streams.length ? <p>No streams.</p> : null}
      {canEdit ? (
        <p>
          <Button type="button" variant="secondary" size="sm" onClick={addStream}>
            Add a stream
          </Button>
        </p>
      ) : null}

      {canEdit ? (
        <div className="ep-savebar">
          <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
            {error ? (
              <span className="ep-field__error">{error}</span>
            ) : problems.length ? (
              <span className="ep-field__error">{problems[0]}</span>
            ) : dirty ? (
              'Changed, not saved yet'
            ) : (
              'Everything is saved'
            )}
          </p>
          <div className="ep-savebar__actions">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={busy || !dirty || problems.length > 0}
            >
              {busy ? 'Saving…' : 'Save the set-up'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
