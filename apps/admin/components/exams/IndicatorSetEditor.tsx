'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addIndicatorArea, saveIndicatorSet, type SetInput } from '@/lib/hpc-actions';

type Row = SetInput['indicators'][number];
export interface ScaleOption {
  name: string;
  levels: string[];
}
const blank = (n: number): Row => ({
  code: '',
  name: '',
  area: '',
  sortOrder: n,
  parentCode: null,
  kind: 'level',
  description: null,
  descriptors: {},
  levels: null,
});
const keyOf = (levels: string[]) => levels.join('|');
const short = (v: string, n = 48) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/**
 * An indicator set (docs/design/65, part 5): its level scale (and, for a progress card, the word each
 * level prints with), then the items: an area (the group), an item under another (one level deep; an
 * item with items under it is a heading), a level or a written observation, and what each level
 * means for the item. A top item may rate on a scale of its own (a card's observations: Rarely ...
 * Always); the items under it use it and are in its area. Areas and scales come from Exams setup →
 * Areas and level scales.
 */
export function IndicatorSetEditor({
  initial,
  areas: areaList,
  scales,
  canAddArea = false,
}: {
  initial?: SetInput;
  areas: string[];
  scales: ScaleOption[];
  canAddArea?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SetInput['kind']>(initial?.kind ?? 'indicators');
  const [grades, setGrades] = useState<string[]>(
    initial?.grades ?? scales[0]?.levels ?? ['A', 'B', 'C'],
  );
  const [words, setWords] = useState<Record<string, string>>(initial?.levelWords ?? {});
  const [rows, setRows] = useState<Row[]>(
    initial?.indicators.length ? initial.indicators : [blank(1)],
  );
  const [areas, setAreas] = useState<string[]>(areaList);
  const [newArea, setNewArea] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  // a scale this set uses that is no longer offered (not in use) still shows as chosen
  const scaleOptions = (current: string[] | null | undefined) =>
    current?.length && !scales.some((s) => keyOf(s.levels) === keyOf(current))
      ? [...scales, { name: current.join(' / '), levels: current }]
      : scales;
  const parentOf = (r: Row) =>
    r.parentCode ? (rows.find((x) => x.code.trim().toUpperCase() === r.parentCode) ?? null) : null;
  // the levels a row takes: its own, else its heading's, else the set's
  const levelsOf = (r: Row): string[] => r.levels ?? parentOf(r)?.levels ?? grades;
  const areaOf = (r: Row) => (r.parentCode ? (parentOf(r)?.area ?? '') : (r.area ?? ''));
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const heads = rows.filter((p) => p.code.trim() && !p.parentCode);
  const headAreas = [...new Set(heads.map((p) => p.area ?? ''))];

  return (
    <form
      className="ep-rp__act"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMsg(null);
          const items = rows
            .filter((r) => r.code.trim() || r.name.trim())
            .map((r, i) => ({
              ...r,
              code: r.code.trim().toUpperCase(),
              name: r.name.trim(),
              area: areaOf(r).trim() || undefined,
              levels: r.parentCode ? null : (r.levels ?? null),
              sortOrder: i + 1,
              parentCode: r.parentCode || null,
              description: r.description?.trim() || null,
              descriptors: Object.fromEntries(
                Object.entries(r.descriptors)
                  .filter(([g, v]) => levelsOf(r).includes(g) && v.trim())
                  .map(([g, v]) => [g, v.trim()]),
              ),
            }));
          const out = await saveIndicatorSet({
            code: code.trim().toUpperCase(),
            name: name.trim(),
            kind,
            grades,
            levelWords: Object.fromEntries(
              Object.entries(words).filter(([g, v]) => grades.includes(g) && v.trim()),
            ),
            indicators: items,
          });
          if (out.ok) {
            setMsg({ tone: 'success', text: 'Saved.' });
            router.refresh();
          } else setMsg({ tone: 'danger', text: out.error });
        });
      }}
    >
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">Code</span>
          <input
            className="ep-input"
            value={code}
            required
            pattern="[A-Za-z0-9_\-]{2,20}"
            readOnly={Boolean(initial)}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Name</span>
          <input
            className="ep-input"
            value={name}
            required
            minLength={2}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Printed as</span>
          <select
            className="ep-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as SetInput['kind'])}
          >
            <option value="indicators">Co-scholastic indicators</option>
            <option value="hpc">Holistic progress card</option>
          </select>
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Level scale</span>
        <select
          className="ep-select"
          value={keyOf(grades)}
          onChange={(e) => setGrades(e.target.value.split('|'))}
        >
          {scaleOptions(grades).map((s) => (
            <option key={keyOf(s.levels)} value={keyOf(s.levels)}>
              {s.name}: {s.levels.join(', ')}
            </option>
          ))}
        </select>
        <span className="ep-field__help">
          From Exams setup → Areas and level scales (add a scale there).
        </span>
      </label>
      {kind === 'hpc' ? (
        <div className="ep-rp__row">
          {grades.map((g) => (
            <label key={g} className="ep-field">
              <span className="ep-field__label">{g} prints with</span>
              <input
                className="ep-input"
                value={words[g] ?? ''}
                maxLength={30}
                placeholder="Stream, Mountain, Sky ..."
                onChange={(e) => setWords((w) => ({ ...w, [g]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      ) : null}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Items of the set">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Items of the set</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Item</th>
              <th scope="col">Area</th>
              <th scope="col">Under</th>
              <th scope="col">Takes</th>
              <th scope="col">What each level means</th>
              <th scope="col">
                <span className="ep-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const n = String(i + 1);
              const area = areaOf(r);
              return (
                <tr key={i}>
                  <td>
                    <input
                      className="ep-input"
                      aria-label={`Code of item ${n}`}
                      value={r.code}
                      style={{ width: 90 }}
                      onChange={(e) => set(i, { code: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      aria-label={`Item ${n}`}
                      value={r.name}
                      maxLength={200}
                      onChange={(e) => set(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    {r.parentCode ? (
                      // an item under a heading is in the heading's area
                      <span className="ep-field__help">{area || '-'}</span>
                    ) : (
                      <select
                        className="ep-select"
                        aria-label={`Area of item ${n}`}
                        value={area}
                        onChange={(e) => set(i, { area: e.target.value })}
                      >
                        <option value="">-</option>
                        {(area && !areas.includes(area) ? [...areas, area] : areas).map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`Item ${n} goes under`}
                      value={r.parentCode ?? ''}
                      onChange={(e) => {
                        const parentCode = e.target.value || null;
                        set(i, { parentCode, ...(parentCode ? { levels: null } : {}) });
                      }}
                    >
                      <option value="">- (a top item)</option>
                      {headAreas.map((a) => (
                        <optgroup key={a || '-'} label={a || 'No area'}>
                          {heads
                            .filter((p) => (p.area ?? '') === a && p !== r)
                            .map((p) => (
                              <option key={p.code} value={p.code.trim().toUpperCase()}>
                                {p.code.trim().toUpperCase()} · {short(p.name)}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`Item ${n} takes`}
                      value={r.kind}
                      onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })}
                    >
                      <option value="level">A level</option>
                      <option value="text">A written note</option>
                    </select>
                    {!r.parentCode && r.kind === 'level' ? (
                      <select
                        className="ep-select"
                        aria-label={`Scale of item ${n}`}
                        value={r.levels?.length ? keyOf(r.levels) : ''}
                        style={{ marginTop: 'var(--sp-1)', minWidth: 180 }}
                        onChange={(e) =>
                          set(i, { levels: e.target.value ? e.target.value.split('|') : null })
                        }
                      >
                        <option value="">The set&rsquo;s scale</option>
                        {scaleOptions(r.levels).map((s) => (
                          <option key={keyOf(s.levels)} value={keyOf(s.levels)}>
                            Own: {s.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td>
                    {r.kind === 'level' ? (
                      <details>
                        <summary>
                          {Object.values(r.descriptors).filter(Boolean).length
                            ? `${String(Object.values(r.descriptors).filter(Boolean).length)} written`
                            : 'Write'}
                        </summary>
                        {levelsOf(r).map((g) => (
                          <label key={g} className="ep-field">
                            <span className="ep-field__label">{g}</span>
                            <input
                              className="ep-input"
                              value={r.descriptors[g] ?? ''}
                              maxLength={200}
                              onChange={(e) =>
                                set(i, { descriptors: { ...r.descriptors, [g]: e.target.value } })
                              }
                            />
                          </label>
                        ))}
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Remove item ${n}`}
                      onClick={() => setRows((x) => x.filter((_, k) => k !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ep-rp__row" style={{ alignItems: 'flex-end' }}>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => setRows((x) => [...x, blank(x.length + 1)])}
        >
          Add an item
        </button>
        {canAddArea ? (
          <>
            <label className="ep-field">
              <span className="ep-field__label">A new area</span>
              <input
                className="ep-input"
                value={newArea}
                maxLength={60}
                onChange={(e) => setNewArea(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending || newArea.trim().length < 2}
              onClick={() =>
                start(async () => {
                  const out = await addIndicatorArea(newArea);
                  if (out.ok) {
                    setAreas((a) => [...a, newArea.trim()]);
                    setNewArea('');
                    setMsg({ tone: 'success', text: 'The area is added to the list.' });
                  } else setMsg({ tone: 'danger', text: out.error });
                })
              }
            >
              Add to the areas
            </button>
          </>
        ) : null}
      </div>
      <p className="ep-field__help">
        An item with items under it prints as a heading (an HPC curricular goal) and is not entered;
        the items under it are in its area and rate on its scale. Removing an item removes what was
        entered for it.
      </p>
      <div className="ep-form-actions">
        <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm" disabled={pending}>
          {initial ? 'Save the set' : 'Add the set'}
        </button>
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </form>
  );
}
