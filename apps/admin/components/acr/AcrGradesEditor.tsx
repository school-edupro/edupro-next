'use client';
import { useState, useTransition } from 'react';
import { saveAcrSettings } from '@/lib/acr-actions';
import type { AcrBand } from '@/lib/acr';

/**
 * The rating words (top of the scale first), the grade for each score % (an "adverse" grade lets the employee
 * object) and the days the employee has to object after seeing the ACR.
 */
export function AcrGradesEditor({
  scaleLabels,
  representationDays,
  staffLateAfter,
  bands,
  canEdit,
}: {
  scaleLabels: string[];
  representationDays: number;
  staffLateAfter: string;
  bands: AcrBand[];
  canEdit: boolean;
}) {
  const [words, setWords] = useState<string[]>(scaleLabels);
  const [days, setDays] = useState(representationDays);
  const [late, setLate] = useState(staffLateAfter);
  const [rows, setRows] = useState<AcrBand[]>(bands);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await saveAcrSettings({
        scaleLabels: words.map((w) => w.trim()).filter(Boolean),
        representationDays: days,
        staffLateAfter: late,
        bands: [...rows].sort((a, b) => b.minPct - a.minPct),
      });
      setMsg(r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error });
    });
  const top = words.filter((w) => w.trim()).length;

  return (
    <div className="ep-grid-2">
      <section className="ep-card" aria-labelledby="acr-scale-h" style={{ padding: 'var(--sp-4)' }}>
        <h2 id="acr-scale-h" className="ep-card__title">
          Rating scale
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Every rating question is answered {top} (best) to 1. The words, best first:
        </p>
        {words.map((w, i) => (
          <label key={String(i)} className="ep-field" htmlFor={`acr-word-${String(i)}`}>
            <span className="ep-field__label">{top - i}</span>
            <input
              id={`acr-word-${String(i)}`}
              className="ep-input"
              value={w}
              maxLength={40}
              disabled={!canEdit}
              onChange={(e) => setWords((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
            />
          </label>
        ))}
        {canEdit ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={words.length >= 10}
              onClick={() => setWords((x) => [...x, ''])}
            >
              + Add a point
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              disabled={words.length <= 3}
              onClick={() => setWords((x) => x.slice(0, -1))}
            >
              Remove the last
            </button>
          </div>
        ) : null}
        <label className="ep-field" htmlFor="acr-days" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="ep-field__label">Days to object after seeing the ACR</span>
          <input
            id="acr-days"
            className="ep-input"
            type="number"
            min={0}
            max={90}
            value={days}
            disabled={!canEdit}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <label className="ep-field" htmlFor="acr-late">
          <span className="ep-field__label">A staff punch after this time is a late arrival</span>
          <input
            id="acr-late"
            className="ep-input"
            type="time"
            value={late}
            disabled={!canEdit}
            onChange={(e) => setLate(e.target.value)}
          />
        </label>
      </section>
      <section className="ep-card" aria-labelledby="acr-bands-h" style={{ padding: 'var(--sp-4)' }}>
        <h2 id="acr-bands-h" className="ep-card__title">
          Grades
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The score % of the rating gives the grade. One grade must start at 0%.
        </p>
        <div className="ep-table-wrap">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">From %</th>
                <th scope="col">Grade</th>
                <th scope="col">Adverse</th>
                <th scope="col">
                  <span className="ep-sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={String(i)}>
                  <td>
                    <input
                      className="ep-input"
                      type="number"
                      min={0}
                      max={100}
                      aria-label={`Grade ${String(i + 1)} from %`}
                      value={b.minPct}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setRows((r) =>
                          r.map((x, j) => (j === i ? { ...x, minPct: Number(e.target.value) } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      aria-label={`Grade ${String(i + 1)} name`}
                      value={b.label}
                      maxLength={40}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setRows((r) =>
                          r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Grade ${String(i + 1)} is adverse`}
                      checked={b.adverse}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setRows((r) =>
                          r.map((x, j) => (j === i ? { ...x, adverse: e.target.checked } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    {canEdit ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Remove grade ${String(i + 1)}`}
                        disabled={rows.length <= 2}
                        onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={rows.length >= 10}
            onClick={() => setRows((r) => [...r, { minPct: 50, label: '', adverse: false }])}
          >
            + Add a grade
          </button>
        ) : null}
      </section>
      {canEdit ? (
        <div style={{ gridColumn: '1 / -1' }}>
          {msg ? (
            <div
              className={`ep-alert ep-alert--${msg.tone}`}
              role="status"
              style={{ marginBottom: 'var(--sp-3)' }}
            >
              {msg.text}
            </div>
          ) : null}
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={save}
            disabled={pending}
          >
            Save scale and grades
          </button>
        </div>
      ) : null}
    </div>
  );
}
