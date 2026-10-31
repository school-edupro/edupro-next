'use client';
import { Button } from '@edupro/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/nav-icons';
import { saveSubjectSetup, type SubjectSetupInput } from '@/lib/exam-entry-actions';
import type { ChoiceGroup, ChoiceStream, ChoiceSubject } from './ChoicesSheet';

/** One subject slot of the class: Subject-k, the subjects a student may have there, a name for a choice. */
interface Row {
  key: string;
  name: string;
  ids: string[];
}
interface Stream {
  key: string;
  name: string;
  ids: string[];
}
interface State {
  rows: Row[];
  streams: Stream[];
  /** a subject entered in parts: its sub-subjects with their share of the maximum */
  parts: Record<string, Array<{ subjectId: string; share: number }>>;
}

const setKey = (ids: string[]) => [...ids].sort().join(',');
const MAX_SLOTS = 15;

/**
 * A class's subject template (docs/design/67): "Number of subjects" and, for Subject-1 … Subject-N, the
 * subjects allowed there. A slot with one subject is taken by everyone; a slot with several is a choice
 * (slots offering the same subjects are one choice taking that many, e.g. two of the languages). Every
 * student fills every slot; the "Optional" tick on the students' grid keeps a subject out of the total.
 * Cards and registers print in slot order. A subject may be entered in parts (Social Science: its
 * sub-subjects with a share of the maximum); a class may have streams (XI-XII). One Save.
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
  const initial = useMemo<State>(() => {
    // the set-up as slots: a subject everyone takes is one, a group as many as it takes
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const x of subjects) {
      if (x.take === 'all') rows.push({ key: `s${x.id}`, name: '', ids: [x.id] });
      else if (x.take === 'group' && x.groupId && !seen.has(x.groupId)) {
        seen.add(x.groupId);
        const g = groups.find((y) => y.id === x.groupId);
        if (g)
          for (let i = 0; i < Math.max(1, g.max); i += 1)
            rows.push({ key: `g${g.id}-${String(i)}`, name: g.name, ids: g.subjectIds });
      }
    }
    return {
      rows,
      streams: streams.map((s) => ({ key: s.id, name: s.name, ids: s.subjectIds })),
      parts: Object.fromEntries(
        subjects.map((x) => [
          x.id,
          (x.parts ?? []).map((p) => ({ subjectId: p.subjectId, share: p.share })),
        ]),
      ),
    };
  }, [subjects, groups, streams]);
  const [s, set] = useState<State>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(1);
  const [count, setCount] = useState(String(initial.rows.length));
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
  const used = new Set(s.rows.flatMap((r) => r.ids));
  const unused = subjects.filter((x) => !used.has(x.id));

  // ---- slots -------------------------------------------------------------------------------------
  const newRow = (): Row => {
    setSeq((n) => n + 1);
    return { key: `new-${String(seq)}-${String(Math.random()).slice(2, 7)}`, name: '', ids: [] };
  };
  const setNumber = (raw: string) => {
    setCount(raw);
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > MAX_SLOTS) return;
    const rows = [...s.rows];
    while (rows.length < n) rows.push(newRow());
    // only empty slots go when the number comes down
    while (rows.length > n && rows[rows.length - 1]!.ids.length === 0) rows.pop();
    set({ ...s, rows });
  };
  const patchRow = (k: number, patch: Partial<Row>) =>
    set({ ...s, rows: s.rows.map((r, i) => (i === k ? { ...r, ...patch } : r)) });
  const move = (k: number, by: -1 | 1) => {
    const j = k + by;
    if (j < 0 || j >= s.rows.length) return;
    const rows = [...s.rows];
    [rows[k], rows[j]] = [rows[j]!, rows[k]!];
    set({ ...s, rows });
  };
  const removeRow = (k: number) => {
    const rows = s.rows.filter((_, i) => i !== k);
    set({ ...s, rows });
    setCount(String(rows.length));
  };
  const addRow = () => {
    if (s.rows.length >= MAX_SLOTS) return;
    const rows = [...s.rows, newRow()];
    set({ ...s, rows });
    setCount(String(rows.length));
  };
  /** what a slot may still add: a subject not in another slot, or one of the slot above's set */
  const addable = (k: number) =>
    subjects.filter(
      (x) =>
        !s.rows[k]!.ids.includes(x.id) && !s.rows.some((r, i) => i !== k && r.ids.includes(x.id)),
    );

  // ---- parts -------------------------------------------------------------------------------------
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
  const partsOf = (id: string) => {
    const kids = sub(id).children ?? [];
    if (!kids.length) return null;
    const mine = s.parts[id] ?? [];
    return (
      <fieldset key={id} className="ep-subchoice__setparts">
        <legend>{sub(id).name}: entered in parts</legend>
        {kids.map((k) => {
          const p = mine.find((x) => x.subjectId === k.id);
          return (
            <span key={k.id} className="ep-subchoice__setpart">
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(p)}
                  disabled={!canEdit}
                  onChange={(e) => setPart(id, k.id, e.target.checked ? 1 : null)}
                />{' '}
                {k.name}
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

  // ---- streams -----------------------------------------------------------------------------------
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

  // ---- checks and save ---------------------------------------------------------------------------
  const problems: string[] = [];
  s.rows.forEach((r, k) => {
    if (!r.ids.length) problems.push(`Subject-${String(k + 1)}: choose its subject(s)`);
  });
  s.rows.forEach((r, k) => {
    const clash = s.rows.findIndex(
      (o, i) =>
        i !== k && o.ids.some((id) => r.ids.includes(id)) && setKey(o.ids) !== setKey(r.ids),
    );
    if (clash > k)
      problems.push(
        `Subject-${String(k + 1)} and Subject-${String(clash + 1)} share a subject but not all: give them the same subjects or none in common`,
      );
  });
  for (const x of s.streams) if (!x.ids.length) problems.push(`${x.name}: tick its subjects`);

  const save = async () => {
    setError(null);
    setBusy(true);
    // slots offering the same subjects are one choice that takes that many
    const choices = new Map<string, { name: string; ids: string[]; slots: number[] }>();
    s.rows.forEach((r, k) => {
      if (r.ids.length < 2) return;
      const c = choices.get(setKey(r.ids));
      if (c) c.slots.push(k);
      else choices.set(setKey(r.ids), { name: r.name.trim(), ids: r.ids, slots: [k] });
    });
    const names = new Set<string>();
    const groupsOut: SubjectSetupInput['groups'] = [];
    for (const c of choices.values()) {
      let name = c.name || `Subject-${c.slots.map((k) => String(k + 1)).join(' & ')}`;
      while (names.has(name.toLowerCase())) name = `${name} (${String(c.slots[0]! + 1)})`;
      names.add(name.toLowerCase());
      groupsOut.push({
        key: setKey(c.ids),
        name,
        kind: 'optional',
        min: c.slots.length,
        max: c.slots.length,
      });
    }
    const order: SubjectSetupInput['subjects'] = [];
    const placed = new Set<string>();
    for (const r of s.rows)
      for (const id of r.ids) {
        if (placed.has(id)) continue;
        placed.add(id);
        order.push(
          r.ids.length === 1
            ? { subjectId: id, take: 'all', group: null, parts: s.parts[id] ?? [] }
            : { subjectId: id, take: 'group', group: setKey(r.ids), parts: s.parts[id] ?? [] },
        );
      }
    // the class's other subjects: not in a slot (no student is offered them in the grid)
    for (const x of subjects)
      if (!placed.has(x.id))
        order.push({ subjectId: x.id, take: 'free', group: null, parts: s.parts[x.id] ?? [] });
    const r = await saveSubjectSetup({
      classId,
      groups: groupsOut,
      subjects: order,
      streams: s.streams.map((x) => ({ name: x.name.trim(), subjectIds: x.ids })),
    });
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

  return (
    <div className="ep-subchoice">
      <h3 style={{ marginTop: 0 }}>Subjects of the class</h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Set how many subjects every student of the class takes, then the subject(s) allowed in each
        slot. One subject: everyone takes it. Several (Hindi, Sanskrit, German): the student chooses
        one; two slots with the same subjects let the student choose two. Report cards and mark
        registers print Subject-1, Subject-2, … in this order. The &ldquo;Optional&rdquo; tick on
        the students&rsquo; grid keeps one student&rsquo;s subject out of the total.
      </p>
      <label className="ep-field" style={{ maxWidth: '14rem' }}>
        <span className="ep-field__label">Number of subjects</span>
        <input
          className="ep-input"
          type="number"
          min={1}
          max={MAX_SLOTS}
          value={count}
          disabled={!canEdit}
          onChange={(e) => setNumber(e.target.value)}
        />
        <span className="ep-field__help">
          {s.rows.length > Number(count) && Number(count) > 0
            ? 'Clear the subjects of the last slots to have fewer.'
            : `Subject-1 to Subject-${String(Math.max(1, s.rows.length))}`}
        </span>
      </label>

      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Subject slots">
        <table className="ep-table ep-subchoice__template">
          <caption className="ep-sr-only">The subject slots of the class</caption>
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Subjects allowed</th>
              <th scope="col">Name of the choice</th>
              {canEdit ? <th scope="col">Move</th> : null}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, k) => {
              const many = r.ids.length > 1;
              const above = s.rows[k - 1];
              return (
                <tr key={r.key}>
                  <th scope="row">
                    Subject-{k + 1}
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {!r.ids.length ? 'not set' : many ? 'choose 1' : 'everyone'}
                    </span>
                  </th>
                  <td>
                    <span className="ep-subchoice__chips">
                      {r.ids.map((id) => (
                        <span key={id} className="ep-subchoice__chip">
                          {label(id)}
                          {canEdit ? (
                            <button
                              type="button"
                              aria-label={`Take ${sub(id).name} out of Subject-${String(k + 1)}`}
                              onClick={() => patchRow(k, { ids: r.ids.filter((x) => x !== id) })}
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {canEdit ? (
                        <select
                          className="ep-select"
                          aria-label={`Add a subject to Subject-${String(k + 1)}`}
                          value=""
                          onChange={(e) => {
                            if (e.target.value) patchRow(k, { ids: [...r.ids, e.target.value] });
                          }}
                          style={{ minWidth: '12rem' }}
                        >
                          <option value="">
                            {r.ids.length ? '+ Add a choice' : 'Select subject'}
                          </option>
                          {addable(k).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} ({x.code})
                            </option>
                          ))}
                        </select>
                      ) : null}
                      {canEdit && !r.ids.length && above && above.ids.length > 1 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => patchRow(k, { ids: above.ids, name: above.name })}
                        >
                          Same as Subject-{k} (a second pick)
                        </Button>
                      ) : null}
                    </span>
                    {r.ids.map((id) => partsOf(id))}
                  </td>
                  <td>
                    {many ? (
                      <input
                        className="ep-input"
                        aria-label={`Name of the choice in Subject-${String(k + 1)}`}
                        placeholder="e.g. Second language"
                        maxLength={60}
                        value={r.name}
                        disabled={!canEdit}
                        onChange={(e) => patchRow(k, { name: e.target.value })}
                      />
                    ) : (
                      <span className="ep-kicker">-</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => move(k, -1)}
                          disabled={k === 0}
                          aria-label={`Move Subject-${String(k + 1)} up`}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => move(k, 1)}
                          disabled={k === s.rows.length - 1}
                          aria-label={`Move Subject-${String(k + 1)} down`}
                        >
                          ↓
                        </Button>
                        <button
                          type="button"
                          className="ep-subchoice__icon"
                          aria-label={`Remove Subject-${String(k + 1)}`}
                          title="Remove the slot"
                          onClick={() => removeRow(k)}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && s.rows.length < MAX_SLOTS ? (
        <p>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            Add a subject slot
          </Button>
        </p>
      ) : null}
      {unused.length ? (
        <p className="ep-field__help">
          <strong>Not in a slot:</strong> {unused.map((x) => x.name).join(', ')}. No student is
          offered them; a student who already has one keeps it (shown after the slots).
        </p>
      ) : null}

      <h3>Streams</h3>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        For classes XI and XII: a stream is a set of subjects (Science-PCM: Physics, Chemistry,
        Mathematics), each in its slot. Choosing a student&rsquo;s stream fills those slots.
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
            {s.rows
              .filter((r) => r.ids.length > 1)
              .flatMap((r) => r.ids)
              .filter((id, i, a) => a.indexOf(id) === i)
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
