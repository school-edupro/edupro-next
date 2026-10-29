'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveIndicatorSet, type SetInput } from '@/lib/hpc-actions';

type Row = SetInput['indicators'][number];
const blank = (n: number): Row => ({
  code: '',
  name: '',
  area: '',
  sortOrder: n,
  parentCode: null,
  kind: 'level',
  description: null,
  descriptors: {},
});

/**
 * An indicator set (docs/design/65, part 5): its levels in order (and, for a progress card, the word
 * each prints with), then the items: an area (the group), an item under another (one level deep; an
 * item with items under it is a heading), a level or a written observation, and what each level
 * means for the item.
 */
export function IndicatorSetEditor({ initial }: { initial?: SetInput }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SetInput['kind']>(initial?.kind ?? 'indicators');
  const [levels, setLevels] = useState((initial?.grades ?? ['A', 'B', 'C']).join(', '));
  const [words, setWords] = useState<Record<string, string>>(initial?.levelWords ?? {});
  const [rows, setRows] = useState<Row[]>(
    initial?.indicators.length ? initial.indicators : [blank(1)],
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const key = initial?.code ?? 'new';
  const grades = levels
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const areas = [...new Set(rows.map((r) => r.area).filter(Boolean))] as string[];

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
              area: r.area?.trim() || undefined,
              sortOrder: i + 1,
              parentCode: r.parentCode || null,
              description: r.description?.trim() || null,
              descriptors: Object.fromEntries(
                Object.entries(r.descriptors)
                  .filter(([g, v]) => grades.includes(g) && v.trim())
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
        <span className="ep-field__label">Levels, lowest first (comma between)</span>
        <input
          className="ep-input"
          value={levels}
          required
          onChange={(e) => setLevels(e.target.value)}
        />
        <span className="ep-field__help">
          Two to ten: grades (A, B, C) or words (Beginner, Progressing, Proficient).
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
      <datalist id={`areas-${key}`}>
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
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
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Code of item ${String(i + 1)}`}
                    value={r.code}
                    style={{ width: 90 }}
                    onChange={(e) => set(i, { code: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Item ${String(i + 1)}`}
                    value={r.name}
                    maxLength={120}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Area of item ${String(i + 1)}`}
                    list={`areas-${key}`}
                    value={r.area ?? ''}
                    maxLength={60}
                    onChange={(e) => set(i, { area: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`Item ${String(i + 1)} goes under`}
                    value={r.parentCode ?? ''}
                    onChange={(e) => set(i, { parentCode: e.target.value || null })}
                  >
                    <option value="">-</option>
                    {rows
                      .filter((p, k) => k !== i && p.code.trim() && !p.parentCode)
                      .map((p) => (
                        <option key={p.code} value={p.code.trim().toUpperCase()}>
                          {p.code.trim().toUpperCase()}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`Item ${String(i + 1)} takes`}
                    value={r.kind}
                    onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })}
                  >
                    <option value="level">A level</option>
                    <option value="text">A written note</option>
                  </select>
                </td>
                <td>
                  {r.kind === 'level' ? (
                    <details>
                      <summary>
                        {Object.values(r.descriptors).filter(Boolean).length
                          ? `${String(Object.values(r.descriptors).filter(Boolean).length)} written`
                          : 'Write'}
                      </summary>
                      {grades.map((g) => (
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
                    aria-label={`Remove item ${String(i + 1)}`}
                    onClick={() => setRows((x) => x.filter((_, k) => k !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => setRows((x) => [...x, blank(x.length + 1)])}
        >
          Add an item
        </button>
      </p>
      <p className="ep-field__help">
        An item with items under it prints as a heading (an HPC curricular goal) and is not entered;
        removing an item removes what was entered for it.
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
