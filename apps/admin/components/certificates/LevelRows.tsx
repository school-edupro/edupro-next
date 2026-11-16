'use client';
import { useState } from 'react';
import { Icon } from '@/components/nav-icons';

export type Level =
  | { kind: 'office' }
  | { kind: 'class_teacher' }
  | { kind: 'signatory' }
  | { kind: 'role'; roleId: string; name?: string };

const LABEL: Record<Level['kind'], string> = {
  office: 'The certificate office',
  class_teacher: "The student's class teacher",
  signatory: 'The signatory (the principal in the certificate settings)',
  role: 'A role',
};

/**
 * The approval levels of a certificate type's requests (docs/design/87, phase C), in order: each the office, the class
 * teacher, the signatory or a role. Posted as one JSON value (`levelsJson`).
 */
export function LevelRows({
  initial,
  roles,
  staff,
}: {
  initial: Level[];
  roles: Array<{ id: string; name: string }>;
  staff: boolean;
}) {
  const [rows, setRows] = useState<Level[]>(initial);
  const kinds = (Object.keys(LABEL) as Level['kind'][]).filter(
    (k) => !(staff && k === 'class_teacher'),
  );
  const set = (i: number, l: Level) => setRows((r) => r.map((x, j) => (j === i ? l : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r];
      const j = i + d;
      if (j < 0 || j >= n.length) return r;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  return (
    <div className="ep-fieldrows">
      <input
        type="hidden"
        name="levelsJson"
        value={JSON.stringify(
          rows.map((l) =>
            l.kind === 'role'
              ? { kind: 'role', roleId: l.roleId, name: roles.find((r) => r.id === l.roleId)?.name }
              : { kind: l.kind },
          ),
        )}
      />
      {rows.length === 0 ? (
        <p className="ep-field__help">No levels: requests cannot be decided.</p>
      ) : null}
      {rows.map((l, i) => (
        <fieldset key={i} className="ep-fieldrows__row">
          <legend className="ep-field__label">Level {i + 1}</legend>
          <label className="ep-field" htmlFor={`lk${i}`}>
            <span className="ep-field__label">Decided by</span>
            <select
              id={`lk${i}`}
              className="ep-select"
              value={l.kind}
              onChange={(e) => {
                const k = e.target.value as Level['kind'];
                set(
                  i,
                  k === 'role'
                    ? { kind: 'role', roleId: roles[0]?.id ?? '' }
                    : ({ kind: k } as Level),
                );
              }}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {l.kind === 'role' ? (
            <label className="ep-field" htmlFor={`lr${i}`}>
              <span className="ep-field__label">Role</span>
              <select
                id={`lr${i}`}
                className="ep-select"
                value={l.roleId}
                onChange={(e) => set(i, { kind: 'role', roleId: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignSelf: 'end' }}>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="Decide earlier"
            >
              <Icon name="arrowUp" size={16} />
              <span className="ep-sr-only">Move level {i + 1} up</span>
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
              title="Decide later"
            >
              <Icon name="arrowDown" size={16} />
              <span className="ep-sr-only">Move level {i + 1} down</span>
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
              title="Remove this level"
            >
              <Icon name="trash" size={16} />
              <span className="ep-sr-only">Remove level {i + 1}</span>
            </button>
          </div>
        </fieldset>
      ))}
      {rows.length < 5 ? (
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          onClick={() => setRows((r) => [...r, { kind: 'office' }])}
        >
          Add a level
        </button>
      ) : null}
    </div>
  );
}
