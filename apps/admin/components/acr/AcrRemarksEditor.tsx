'use client';
import { useState, useTransition } from 'react';
import { saveAcrRemarks } from '@/lib/acr-actions';
import type { AcrRemarkLine } from '@/lib/acr';

type Line = { id?: string; grade: string; text: string; active: boolean; key: string };

/**
 * Principal's remarks (0195): the standard lines the final level ticks at approval, grouped by grade.
 * Each grade gets its lines; a line switched off stays for the ACRs that ticked it. Lines come in from a
 * CSV (grade, remark, status) and go out the same way.
 */
export function AcrRemarksEditor({
  lines,
  grades,
  canEdit,
  importAction,
}: {
  lines: AcrRemarkLine[];
  /** the grade bands, best first */
  grades: string[];
  canEdit: boolean;
  importAction: (fd: FormData) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Line[]>(
    lines.map((l) => ({ id: l.id, grade: l.grade, text: l.text, active: l.active, key: l.id })),
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const groups = [...grades, ...rows.map((r) => r.grade).filter((g) => !grades.includes(g))].filter(
    (g, i, all) => all.indexOf(g) === i,
  );
  const update = (key: string, patch: Partial<Line>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (grade: string) =>
    setRows((cur) => [
      ...cur,
      { grade, text: '', active: true, key: `new-${String(Date.now())}-${String(cur.length)}` },
    ]);
  const save = () =>
    start(async () => {
      const out = rows
        .filter((r) => r.text.trim().length >= 3)
        .map((r, i) => ({
          id: r.id,
          grade: r.grade,
          text: r.text.trim(),
          sortOrder: (i + 1) * 10,
          active: r.active,
        }));
      const res = await saveAcrRemarks(out);
      setMsg(res.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: res.error });
    });
  const csv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const body = [
      ['grade', 'remark', 'status'].join(','),
      ...rows.map((r) => [esc(r.grade), esc(r.text), r.active ? 'Active' : 'Inactive'].join(',')),
    ].join('\r\n');
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${body}`)}`;
  };
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <section className="ep-card" aria-labelledby="acr-rem-h" style={{ padding: 'var(--sp-4)' }}>
        <h2 id="acr-rem-h" className="ep-card__title">
          Principal’s remarks
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          At the final approval the Principal picks the grade and ticks any of these lines for it,
          adding their own words. A line switched off stays on the ACRs that already carry it.
        </p>
        {msg ? (
          <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
            {msg.text}
          </p>
        ) : null}
        {groups.map((g) => (
          <fieldset key={g} className="ep-field" style={{ border: 0, padding: 0 }}>
            <legend className="ep-field__label">
              {g}
              {!grades.includes(g) ? ' (not a grade of the scale)' : ''}
            </legend>
            {rows
              .filter((r) => r.grade === g)
              .map((r, i) => (
                <div
                  key={r.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 'var(--sp-2)',
                    alignItems: 'start',
                    marginBottom: 'var(--sp-2)',
                  }}
                >
                  <label className="ep-field" htmlFor={`rem-${r.key}`} style={{ margin: 0 }}>
                    <span className="ep-sr-only">
                      {g} line {i + 1}
                    </span>
                    <textarea
                      id={`rem-${r.key}`}
                      className="ep-input"
                      rows={2}
                      maxLength={1000}
                      value={r.text}
                      disabled={!canEdit}
                      onChange={(e) => update(r.key, { text: e.target.value })}
                    />
                  </label>
                  <label className="ep-check" htmlFor={`rem-on-${r.key}`}>
                    <input
                      id={`rem-on-${r.key}`}
                      type="checkbox"
                      checked={r.active}
                      disabled={!canEdit}
                      onChange={(e) => update(r.key, { active: e.target.checked })}
                    />{' '}
                    On
                  </label>
                </div>
              ))}
            {canEdit ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => add(g)}
              >
                Add a line for {g}
              </button>
            ) : null}
          </fieldset>
        ))}
        {canEdit ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              onClick={save}
              disabled={pending}
            >
              Save
            </button>
            <a className="ep-btn ep-btn--secondary" href={csv()} download="principal-remarks.csv">
              Download CSV
            </a>
          </div>
        ) : null}
      </section>
      {canEdit ? (
        <section
          className="ep-card"
          aria-labelledby="acr-rem-up"
          style={{ padding: 'var(--sp-4)' }}
        >
          <h2 id="acr-rem-up" className="ep-card__title">
            Upload lines
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A CSV with the columns grade, remark and status (the legacy export’s layout). A grade
            such as “02/05 - Below Average” is read as the band; lines already there are skipped.
          </p>
          <form
            action={importAction}
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end' }}
          >
            <label className="ep-field" htmlFor="rem-file" style={{ margin: 0 }}>
              <span className="ep-field__label">CSV file</span>
              <input
                id="rem-file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                className="ep-input"
                required
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Upload
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
