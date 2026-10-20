'use client';
import { useState, useTransition } from 'react';
import { saveRecruitmentStages } from '@/lib/recruitment-actions';
import { STAGE_KIND, type RecruitmentStage, type StageKind } from '@/lib/recruitment';

type Row = RecruitmentStage & { key: string };

/**
 * The school's screening stages, in order (0197): each vacancy ticks the ones it uses. A stage records a
 * yes/no on the papers (shortlisting), marks (a test, an interview) or the selection (the final round).
 * A stage switched off stays on the vacancies that already use it.
 */
export function StagesEditor({
  stages,
  canEdit,
}: {
  stages: RecruitmentStage[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(stages.map((s) => ({ ...s, key: s.id })));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: string, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () =>
    setRows((cur) => [
      ...cur,
      {
        id: '',
        key: `new-${String(Date.now())}`,
        name: '',
        kind: 'interview',
        maxMarks: null,
        active: true,
      },
    ]);
  const save = () =>
    start(async () => {
      const r = await saveRecruitmentStages(
        rows
          .filter((x) => x.name.trim())
          .map((x) => ({
            ...(x.id ? { id: x.id } : {}),
            name: x.name.trim(),
            kind: x.kind,
            maxMarks: x.kind === 'test' || x.kind === 'interview' ? x.maxMarks : null,
            active: x.active,
          })),
      );
      setMsg(r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error });
    });
  return (
    <section className="ep-card" aria-labelledby="rs-h" style={{ padding: 'var(--sp-4)' }}>
      <h2 id="rs-h" className="ep-card__title">
        Screening stages
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The order candidates go through. Each vacancy ticks the stages it uses.
      </p>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </p>
      ) : null}
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">Screening stages</caption>
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">What it records</th>
              <th scope="col">Out of (marks)</th>
              <th scope="col">On</th>
              <th scope="col">
                <span className="ep-sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>
                  <input
                    className="ep-input"
                    aria-label={`Name of stage ${String(i + 1)}`}
                    maxLength={80}
                    value={r.name}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="ep-select"
                    aria-label={`What stage ${String(i + 1)} records`}
                    value={r.kind}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { kind: e.target.value as StageKind })}
                  >
                    {(Object.keys(STAGE_KIND) as StageKind[]).map((k) => (
                      <option key={k} value={k}>
                        {STAGE_KIND[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {r.kind === 'test' || r.kind === 'interview' ? (
                    <input
                      className="ep-input"
                      type="number"
                      min={1}
                      max={1000}
                      aria-label={`Marks out of, stage ${String(i + 1)}`}
                      value={r.maxMarks ?? ''}
                      disabled={!canEdit}
                      onChange={(e) =>
                        set(r.key, { maxMarks: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  ) : (
                    <span className="ep-field__help">—</span>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Stage ${String(i + 1)} on`}
                    checked={r.active}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { active: e.target.checked })}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move stage ${String(i + 1)} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Move stage ${String(i + 1)} down`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <button type="button" className="ep-btn ep-btn--ghost" onClick={add}>
            Add a stage
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={save}
            disabled={pending}
          >
            Save
          </button>
        </div>
      ) : null}
    </section>
  );
}
