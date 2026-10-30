'use client';
import { Button } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { saveMarksSheet, type MarkRow } from '@/lib/exam-sheet-actions';

export interface SheetRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  /** how the student takes the subject (null: does not take it) and its words */
  taken: string | null;
  takenLabel: string;
  marks: string;
  code: string;
  grade: string;
}
type Cell = { marks: string; code: string; grade: string };

/**
 * Marks of one section's subject, or one part of it (docs/design/66): a mark (or a grade) or a code per
 * student, the count entered as it is typed, a mark above the maximum shown at once, Enter to the next
 * student, and Save or Save and submit from the bar at the foot. Asks before unsaved marks are left.
 */
export function MarksSheet({
  examId,
  classSectionId,
  subjectId,
  partId,
  subjectName,
  rows,
  codes,
  grades,
  gradeOnly,
  max,
  canEdit,
  canSubmit,
}: {
  examId: string;
  classSectionId: string;
  subjectId: string;
  partId: string | null;
  subjectName: string;
  rows: SheetRow[];
  codes: Array<{ code: string; name: string }>;
  grades: string[];
  gradeOnly: boolean;
  max: number;
  canEdit: boolean;
  canSubmit: boolean;
}) {
  const t = useTranslations('examHub.entry');
  const s = useTranslations('examHub.setup');
  const leaving = useRef(false);
  const table = useRef<HTMLTableElement>(null);
  const initial = useMemo(
    () =>
      Object.fromEntries(
        rows.map((r) => [r.studentId, { marks: r.marks, code: r.code, grade: r.grade }]),
      ) as Record<string, Cell>,
    [rows],
  );
  const [cells, setCells] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const takers = rows.filter((r) => r.taken);
  const changed = takers.filter((r) => {
    const a = cells[r.studentId]!;
    const b = initial[r.studentId]!;
    return a.marks !== b.marks || a.code !== b.code || a.grade !== b.grade;
  });
  const dirty = changed.length > 0;
  const entered = takers.filter((r) => {
    const c = cells[r.studentId]!;
    return c.code || c.grade || c.marks !== '';
  }).length;
  const wrong = (c: Cell) =>
    !gradeOnly && !c.code && c.marks !== '' && (Number(c.marks) < 0 || Number(c.marks) > max);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (studentId: string, patch: Partial<Cell>) =>
    setCells((cs) => ({ ...cs, [studentId]: { ...cs[studentId]!, ...patch } }));
  // Enter goes to the next student's box, as on paper
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, i: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const boxes = table.current?.querySelectorAll<HTMLElement>('[data-mark]');
    boxes?.[i + 1]?.focus();
  };

  const save = async (submit: boolean) => {
    setError(null);
    if (changed.some((r) => wrong(cells[r.studentId]!))) {
      setError(t('fixFirst'));
      return;
    }
    // a part's emptied box clears its mark; a subject's empty row is not sent
    const out: MarkRow[] = changed
      .map((r) => ({ id: r.studentId, c: cells[r.studentId]! }))
      .filter(({ c }) => partId || c.code || c.grade || c.marks !== '')
      .map(({ id, c }) => ({
        studentId: id,
        marks: c.code || c.marks === '' ? null : Number(c.marks),
        code: c.code || null,
        grade: c.code ? null : c.grade || null,
      }));
    setBusy(true);
    const r = await saveMarksSheet({
      examId,
      classSectionId,
      subjectId,
      partId,
      rows: out,
      submit,
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

  const codeList = partId ? codes.filter((c) => c.code === 'AB') : codes;
  let box = -1;
  return (
    <div>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={subjectName}>
        <table ref={table} className="ep-table ep-table--dense">
          <caption className="ep-sr-only">{subjectName}</caption>
          <thead>
            <tr>
              <th scope="col">{t('roll')}</th>
              <th scope="col">{t('student')}</th>
              <th scope="col">{gradeOnly ? t('grade') : t('marksOf', { max })}</th>
              <th scope="col">{t('code')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = cells[r.studentId]!;
              const bad = wrong(c);
              if (r.taken) box += 1;
              const i = box;
              return (
                <tr key={r.studentId}>
                  <td>{r.rollNo ?? ''}</td>
                  <th scope="row">
                    {r.name}
                    <span className="ep-kicker" style={{ display: 'block' }}>
                      {r.admissionNo}
                      {r.takenLabel ? ` · ${r.takenLabel}` : ''}
                    </span>
                  </th>
                  {!r.taken ? (
                    <td colSpan={2}>
                      <span className="ep-field__help" style={{ margin: 0 }}>
                        {t('notTaken', { subject: subjectName })}
                      </span>
                    </td>
                  ) : (
                    <>
                      <td>
                        {gradeOnly ? (
                          <select
                            className="ep-select"
                            data-mark=""
                            aria-label={`${t('grade')} · ${r.name}`}
                            value={c.grade}
                            disabled={!canEdit || Boolean(c.code)}
                            onChange={(e) => set(r.studentId, { grade: e.target.value })}
                            onKeyDown={(e) => onKey(e, i)}
                          >
                            <option value="">-</option>
                            {grades.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <input
                              className="ep-input"
                              data-mark=""
                              type="number"
                              inputMode="decimal"
                              aria-label={`${t('marksOf', { max })} · ${r.name}`}
                              aria-invalid={bad || undefined}
                              aria-describedby={bad ? `mx-${r.studentId}` : undefined}
                              min={0}
                              max={max}
                              step="0.5"
                              value={c.code ? '' : c.marks}
                              disabled={!canEdit || Boolean(c.code)}
                              onChange={(e) => set(r.studentId, { marks: e.target.value })}
                              onKeyDown={(e) => onKey(e, i)}
                              style={{ width: '7rem' }}
                            />
                            {bad ? (
                              <span id={`mx-${r.studentId}`} className="ep-field__error">
                                {t('aboveMax', { max })}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        <select
                          className="ep-select"
                          aria-label={`${t('code')} · ${r.name}`}
                          value={c.code}
                          disabled={!canEdit}
                          onChange={(e) => set(r.studentId, { code: e.target.value })}
                        >
                          <option value="">-</option>
                          {codeList.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.code} · {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="ep-savebar">
          <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
            {error ? (
              <span className="ep-field__error">{error}</span>
            ) : dirty ? (
              s('dirty')
            ) : (
              s('clean')
            )}{' '}
            · {t('entered', { n: entered, m: takers.length })}
          </p>
          <div className="ep-savebar__actions">
            <Button type="button" onClick={() => void save(false)} disabled={busy || !dirty}>
              {busy ? s('saving') : t('save')}
            </Button>
            {canSubmit ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void save(true)}
                disabled={busy || entered < takers.length}
                title={entered < takers.length ? t('submitNeeds') : undefined}
              >
                {t('saveSubmit')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
