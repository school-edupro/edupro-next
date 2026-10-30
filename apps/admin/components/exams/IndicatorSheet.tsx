'use client';
import { Button } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { saveIndicatorSheet } from '@/lib/exam-sheet-actions';

export interface SheetCell {
  id: string;
  name: string;
  kind: 'level' | 'text';
  levels: string[];
}
export interface SheetArea {
  name: string;
  /** the top items; a heading's cells are its items (none: the item is a cell itself) */
  groups: Array<{ id: string; name: string; kids: SheetCell[] }>;
  cells: SheetCell[];
}
export interface SheetChild {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  /** item → its level, or its written note */
  values: Record<string, string>;
}

const key = (studentId: string, itemId: string) => `${studentId}|${itemId}`;

/**
 * A section's indicators in every area (docs/design/66, phase 2): the areas are tabs, what is chosen
 * in one area stays while another is open, and one Save sends every change. Each tab says how many
 * cells are filled. Asks before unsaved changes are left.
 */
export function IndicatorSheet({
  examId,
  classSectionId,
  areas,
  rows,
  levelWords,
  open,
  initialArea,
}: {
  examId: string;
  classSectionId: string;
  areas: SheetArea[];
  rows: SheetChild[];
  levelWords: Record<string, string>;
  open: boolean;
  initialArea: string;
}) {
  const t = useTranslations('examHub.entry');
  const s = useTranslations('examHub.setup');
  const leaving = useRef(false);
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rows)
      for (const a of areas)
        for (const c of a.cells) m[key(r.studentId, c.id)] = r.values[c.id] ?? '';
    return m;
  }, [rows, areas]);
  const [values, setValues] = useState(initial);
  const [area, setArea] = useState(
    areas.some((a) => a.name === initialArea) ? initialArea : (areas[0]?.name ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = Object.keys(values).filter((k) => values[k] !== initial[k]);
  const dirty = changed.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const choose = (name: string) => {
    setArea(name);
    // the address keeps the open area, so a reload or a saved sheet comes back to it
    const url = new URL(window.location.href);
    url.searchParams.set('area', name);
    window.history.replaceState(null, '', url.toString());
  };
  const filled = (a: SheetArea) =>
    rows.reduce((n, r) => n + a.cells.filter((c) => values[key(r.studentId, c.id)]).length, 0);
  const word = (g: string) => (levelWords[g] ? `${g} (${levelWords[g]})` : g);
  const kinds = useMemo(
    () => new Map(areas.flatMap((a) => a.cells.map((c) => [c.id, c.kind] as const))),
    [areas],
  );

  const save = async () => {
    setError(null);
    setBusy(true);
    const r = await saveIndicatorSheet(
      examId,
      classSectionId,
      changed.map((k) => {
        const [studentId, indicatorId] = k.split('|') as [string, string];
        const v = values[k]!.trim();
        const text = kinds.get(indicatorId) === 'text';
        return {
          studentId,
          indicatorId,
          grade: text ? null : v || null,
          note: text ? v || null : null,
        };
      }),
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    leaving.current = true;
    const url = new URL(window.location.href);
    for (const k of ['error', 'detail']) url.searchParams.delete(k);
    url.searchParams.set('area', area);
    url.searchParams.set('ok', '1');
    window.location.assign(url.toString());
  };

  const current = areas.find((a) => a.name === area);
  const hasGoals = current?.groups.some((g) => g.kids.length > 0) ?? false;
  return (
    <div>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {t('indicatorsHelp')}
      </p>
      <div
        role="tablist"
        aria-label={t('areas')}
        className="ep-xchips"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {areas.map((a) => {
          const total = a.cells.length * rows.length;
          return (
            <button
              key={a.name}
              type="button"
              role="tab"
              aria-selected={a.name === area}
              aria-controls="ind-panel"
              className="ep-xlock"
              onClick={() => choose(a.name)}
            >
              {a.name}
              <span className="ep-sr-only">: </span>
              <span className="ep-meter__text">{t('areaCount', { n: filled(a), m: total })}</span>
            </button>
          );
        })}
      </div>
      {current ? (
        <div id="ind-panel" role="tabpanel" aria-label={current.name}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={current.name}>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{current.name}</caption>
              <thead>
                <tr>
                  <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                    {t('roll')}
                  </th>
                  <th scope="col" rowSpan={hasGoals ? 2 : 1}>
                    {t('child')}
                  </th>
                  {current.groups.map((g) =>
                    g.kids.length ? (
                      <th key={g.id} scope="colgroup" colSpan={g.kids.length}>
                        {g.name}
                      </th>
                    ) : (
                      <th key={g.id} scope="col" rowSpan={hasGoals ? 2 : 1}>
                        {g.name}
                      </th>
                    ),
                  )}
                </tr>
                {hasGoals ? (
                  <tr>
                    {current.groups.flatMap((g) =>
                      g.kids.map((k) => (
                        <th key={k.id} scope="col">
                          {k.name}
                        </th>
                      )),
                    )}
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId}>
                    <td>{r.rollNo ?? ''}</td>
                    <th scope="row">
                      {r.name}
                      <span className="ep-kicker" style={{ display: 'block' }}>
                        {r.admissionNo}
                      </span>
                    </th>
                    {current.cells.map((c) => {
                      const k = key(r.studentId, c.id);
                      const label = `${c.name} · ${r.name}`;
                      return (
                        <td key={c.id}>
                          {c.kind === 'text' ? (
                            <input
                              className="ep-input"
                              aria-label={label}
                              maxLength={600}
                              value={values[k] ?? ''}
                              disabled={!open}
                              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                              style={{ minWidth: '11rem' }}
                            />
                          ) : (
                            <select
                              className="ep-select"
                              aria-label={label}
                              value={values[k] ?? ''}
                              disabled={!open}
                              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            >
                              <option value="">-</option>
                              {c.levels.map((g) => (
                                <option key={g} value={g}>
                                  {word(g)}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="ep-savebar">
          <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
            {error ? (
              <span className="ep-field__error">{error}</span>
            ) : dirty ? (
              s('dirty')
            ) : (
              s('clean')
            )}
          </p>
          <div className="ep-savebar__actions">
            <Button type="button" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? s('saving') : t('saveAll')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
