'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveMarkScheme } from '@/lib/exam-entry-actions';
import {
  KINDS,
  ROUNDING,
  type Rounding,
  type SchemeColumn,
  type SchemeDef,
} from '@/lib/mark-schemes';

const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));
const list = (v: string) =>
  v
    .split(/[,\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
/** "First 60, Second 45" ↔ divisions; "96 5, 91 4" ↔ attendance slabs */
const pairs = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(.*?)\s+(\d+(?:\.\d+)?)$/.exec(x);
      return m ? { a: m[1]!.trim(), b: Number(m[2]) } : null;
    })
    .filter((x): x is { a: string; b: number } => x !== null);

/**
 * The columns of a mark scheme (docs/design/65, part 3): its exams by key, then each column (an exam's
 * marks or a part of them, an average or best of N, a sum, a conversion, attendance slabs), the one
 * marks obtained column, and the result rules. A locked version shows read-only.
 */
export function SchemeEditor({
  id,
  def: initial,
  readOnly,
  exams,
  scales,
}: {
  id: string;
  def: SchemeDef;
  readOnly: boolean;
  exams: Array<{ id: string; code: string; name: string }>;
  scales: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [def, setDef] = useState<SchemeDef>(initial);
  const [divisions, setDivisions] = useState(
    (initial.result.divisions ?? []).map((d) => `${d.name} ${String(d.minPct)}`).join(', '),
  );
  const [slabs, setSlabs] = useState(
    (initial.attendance ?? []).map((d) => `${String(d.minPct)} ${String(d.marks)}`).join(', '),
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const setCol = (i: number, patch: Partial<SchemeColumn>) =>
    setDef((d) => ({
      ...d,
      columns: d.columns.map((c, j) => (j === i ? clean({ ...c, ...patch }) : c)),
    }));
  const clean = (c: SchemeColumn): SchemeColumn =>
    Object.fromEntries(
      Object.entries(c).filter(([, v]) => v !== undefined && v !== '' && v !== false),
    ) as unknown as SchemeColumn;
  const move = (i: number, by: number) =>
    setDef((d) => {
      const cols = [...d.columns];
      const [c] = cols.splice(i, 1);
      cols.splice(Math.max(0, Math.min(cols.length, i + by)), 0, c!);
      return { ...d, columns: cols };
    });
  const examKeys = def.exams.map((e) => e.key);

  const save = () =>
    start(async () => {
      const body: SchemeDef = {
        ...def,
        result: {
          ...def.result,
          divisions: pairs(divisions).map((p) => ({ name: p.a, minPct: p.b })),
        },
        attendance: pairs(slabs).map((p) => ({ minPct: Number(p.a), marks: p.b })),
      };
      if (!body.attendance?.length) delete body.attendance;
      const r = await saveMarkScheme(id, { def: body });
      if (r.ok) {
        setMsg(
          r.data.problems.length
            ? { tone: 'danger', text: `Saved, still to fix: ${r.data.problems.join('; ')}` }
            : { tone: 'success', text: 'Saved: try it on a section, then lock it.' },
        );
        router.refresh();
      } else setMsg({ tone: 'danger', text: r.error });
    });

  const dis = readOnly || pending;
  return (
    <div className="ep-rp__act">
      <h3 className="ep-cdash__h3">Exams it reads</h3>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Exams of the scheme">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Exams of the scheme</caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Exam</th>
              <th scope="col">
                <span className="ep-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {def.exams.map((e, i) => (
              <tr key={String(i)}>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Key of exam ${String(i + 1)}`}
                    value={e.key}
                    maxLength={12}
                    disabled={dis}
                    style={{ width: 90 }}
                    onChange={(v) =>
                      setDef((d) => ({
                        ...d,
                        exams: d.exams.map((x, j) =>
                          j === i ? { ...x, key: v.target.value.toUpperCase() } : x,
                        ),
                      }))
                    }
                  />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`Exam for ${e.key}`}
                    value={e.examId}
                    disabled={dis}
                    onChange={(v) =>
                      setDef((d) => ({
                        ...d,
                        exams: d.exams.map((x, j) =>
                          j === i ? { ...x, examId: v.target.value } : x,
                        ),
                      }))
                    }
                  >
                    {exams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {!readOnly ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      disabled={dis || def.exams.length < 2}
                      onClick={() =>
                        setDef((d) => ({ ...d, exams: d.exams.filter((_, j) => j !== i) }))
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={dis || !exams.length}
            onClick={() =>
              setDef((d) => ({
                ...d,
                exams: [
                  ...d.exams,
                  { key: `EXAM${String(d.exams.length + 1)}`, examId: exams[0]!.id },
                ],
              }))
            }
          >
            Add an exam
          </button>
        </div>
      ) : null}

      <h3 className="ep-cdash__h3">Columns</h3>
      <p className="ep-field__help" style={{ margin: 0 }}>
        In order: a column is made from columns above it. Maximum: the column&rsquo;s maximum after
        conversion (or &ldquo;rest&rdquo;: what the other parts of the marks obtained leave of its
        maximum). Tick one column as the marks obtained.
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Columns of the scheme">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Columns of the scheme</caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Heading</th>
              <th scope="col">Made as</th>
              <th scope="col">From</th>
              <th scope="col">Best</th>
              <th scope="col">Maximum</th>
              <th scope="col">Rounding</th>
              <th scope="col">Marks obtained</th>
              <th scope="col">Hidden</th>
              <th scope="col">
                <span className="ep-sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {def.columns.map((c, i) => (
              <tr key={String(i)}>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Key of column ${String(i + 1)}`}
                    value={c.key}
                    maxLength={12}
                    disabled={dis}
                    style={{ width: 80 }}
                    onChange={(v) => setCol(i, { key: v.target.value.toUpperCase() })}
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Heading of ${c.key}`}
                    value={c.label}
                    maxLength={40}
                    disabled={dis}
                    style={{ width: 150 }}
                    onChange={(v) => setCol(i, { label: v.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`How ${c.key} is made`}
                    value={c.kind}
                    disabled={dis}
                    onChange={(v) => setCol(i, { kind: v.target.value as SchemeColumn['kind'] })}
                  >
                    {Object.entries(KINDS).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {c.kind === 'raw' ? (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                      <select
                        className="ep-select"
                        aria-label={`Exam of ${c.key}`}
                        value={c.exam ?? ''}
                        disabled={dis}
                        onChange={(v) => setCol(i, { exam: v.target.value })}
                      >
                        <option value="">-</option>
                        {examKeys.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <input
                        className="ep-input"
                        aria-label={`Part of ${c.key} (Theory, Practical)`}
                        placeholder="part"
                        value={c.part ?? ''}
                        maxLength={60}
                        disabled={dis}
                        style={{ width: 90 }}
                        onChange={(v) => setCol(i, { part: v.target.value || undefined })}
                      />
                      <select
                        className="ep-select"
                        aria-label={`Pass group of ${c.key}`}
                        value={c.passGroup ?? ''}
                        disabled={dis}
                        onChange={(v) =>
                          setCol(i, {
                            passGroup: (v.target.value || undefined) as SchemeColumn['passGroup'],
                          })
                        }
                      >
                        <option value="">no pass group</option>
                        <option value="theory">theory</option>
                        <option value="practical">practical</option>
                      </select>
                    </span>
                  ) : c.kind === 'attendance' ? (
                    <span className="ep-field__help">the slabs below</span>
                  ) : (
                    <input
                      className="ep-input"
                      aria-label={`Columns ${c.key} is made from`}
                      placeholder="MT1, MT2"
                      value={(c.of ?? []).join(', ')}
                      disabled={dis}
                      style={{ width: 130 }}
                      onChange={(v) => setCol(i, { of: list(v.target.value) })}
                    />
                  )}
                </td>
                <td>
                  {c.kind === 'average' ? (
                    <input
                      className="ep-input"
                      type="number"
                      aria-label={`Best N of ${c.key}`}
                      min={1}
                      max={10}
                      value={c.best ?? ''}
                      disabled={dis}
                      style={{ width: 60 }}
                      onChange={(v) => setCol(i, { best: num(v.target.value) })}
                    />
                  ) : null}
                </td>
                <td>
                  {c.kind !== 'raw' && c.kind !== 'attendance' ? (
                    <input
                      className="ep-input"
                      aria-label={`Maximum of ${c.key}`}
                      placeholder="as is"
                      value={c.scale === undefined ? '' : String(c.scale)}
                      disabled={dis}
                      style={{ width: 70 }}
                      onChange={(v) => {
                        const t = v.target.value.trim().toLowerCase();
                        setCol(i, { scale: t === 'rest' ? 'rest' : num(t) });
                      }}
                    />
                  ) : null}
                  {c.total && c.kind === 'sum' ? (
                    <input
                      className="ep-input"
                      type="number"
                      aria-label={`Out of (for "rest") · ${c.key}`}
                      placeholder="out of"
                      value={c.target ?? ''}
                      disabled={dis}
                      style={{ width: 70 }}
                      onChange={(v) => setCol(i, { target: num(v.target.value) })}
                    />
                  ) : null}
                </td>
                <td>
                  {c.kind !== 'raw' ? (
                    <select
                      className="ep-select"
                      aria-label={`Rounding of ${c.key}`}
                      value={c.round ?? 'two'}
                      disabled={dis}
                      onChange={(v) => setCol(i, { round: v.target.value as Rounding })}
                    >
                      {Object.entries(ROUNDING).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </td>
                <td>
                  <input
                    type="radio"
                    name={`total-${id}`}
                    aria-label={`${c.key} is the marks obtained`}
                    checked={Boolean(c.total)}
                    disabled={dis}
                    onChange={() =>
                      setDef((d) => ({
                        ...d,
                        columns: d.columns.map((x, j) => clean({ ...x, total: j === i })),
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${c.key} is not printed`}
                    checked={Boolean(c.hidden)}
                    disabled={dis}
                    onChange={(v) => setCol(i, { hidden: v.target.checked })}
                  />
                </td>
                <td>
                  {!readOnly ? (
                    <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move ${c.key} up`}
                        disabled={dis || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move ${c.key} down`}
                        disabled={dis || i === def.columns.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Remove ${c.key}`}
                        disabled={dis || def.columns.length < 2}
                        onClick={() =>
                          setDef((d) => ({ ...d, columns: d.columns.filter((_, j) => j !== i) }))
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={dis}
            onClick={() =>
              setDef((d) => ({
                ...d,
                columns: [
                  ...d.columns,
                  {
                    key: `C${String(d.columns.length + 1)}`,
                    label: 'New column',
                    kind: 'raw',
                    exam: examKeys[0],
                  },
                ],
              }))
            }
          >
            Add a column
          </button>
        </div>
      ) : null}

      <h3 className="ep-cdash__h3">Result rules</h3>
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">Pass %</span>
          <input
            className="ep-input"
            type="number"
            min={0}
            max={100}
            value={def.result.passPct}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({ ...d, result: { ...d.result, passPct: Number(v.target.value) } }))
            }
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Compartment up to (subjects)</span>
          <input
            className="ep-input"
            type="number"
            min={0}
            max={5}
            value={def.result.compartmentUpTo}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({
                ...d,
                result: { ...d.result, compartmentUpTo: Number(v.target.value) },
              }))
            }
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Rank by</span>
          <select
            className="ep-select"
            value={def.result.rankBy}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({
                ...d,
                result: { ...d.result, rankBy: v.target.value as 'total' | 'pct' },
              }))
            }
          >
            <option value="total">Total</option>
            <option value="pct">Percentage</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Grand total</span>
          <select
            className="ep-select"
            value={def.result.totalRound ?? 'two'}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({
                ...d,
                result: { ...d.result, totalRound: v.target.value as Rounding },
              }))
            }
          >
            {Object.entries(ROUNDING).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <label className="ep-check" htmlFor={`pe-${id}`}>
          <input
            id={`pe-${id}`}
            className="ep-check__input"
            type="checkbox"
            checked={Boolean(def.result.partsEach)}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({ ...d, result: { ...d.result, partsEach: v.target.checked } }))
            }
          />{' '}
          Theory and practical must each pass
        </label>
        <label className="ep-check" htmlFor={`ca-${id}`}>
          <input
            id={`ca-${id}`}
            className="ep-check__input"
            type="checkbox"
            checked={Boolean(def.result.countAdditional)}
            disabled={dis}
            onChange={(v) =>
              setDef((d) => ({
                ...d,
                result: { ...d.result, countAdditional: v.target.checked },
              }))
            }
          />{' '}
          Additional subjects count in the total
        </label>
      </div>
      <div className="ep-rp__row">
        <label className="ep-field">
          <span className="ep-field__label">Divisions (name and from %)</span>
          <input
            className="ep-input"
            value={divisions}
            placeholder="First 60, Second 45, Pass 33"
            disabled={dis}
            onChange={(v) => setDivisions(v.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Attendance slabs (from % and marks)</span>
          <input
            className="ep-input"
            value={slabs}
            placeholder="96 5, 91 4, 86 3, 81 2, 76 1"
            disabled={dis}
            onChange={(v) => setSlabs(v.target.value)}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Grade scale</span>
          <select
            className="ep-select"
            value={def.gradeScaleId ?? ''}
            disabled={dis}
            onChange={(v) => setDef((d) => ({ ...d, gradeScaleId: v.target.value || null }))}
          >
            <option value="">The class&rsquo;s (from the exams)</option>
            {scales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!readOnly ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={save}
          >
            Save the scheme
          </button>
        </div>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
