'use client';
import { Button } from '@edupro/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { saveDateSheet, type SubjectInput } from '@/lib/exam-hub-actions';

export interface PaperRow extends SubjectInput {
  code: string;
  name: string;
}

/**
 * A class's date sheet (docs/design/66): each paper's date and time (one time can be applied to every
 * paper), and the exam's note printed under every class's sheet. Asks before an unsaved page is left.
 */
export function DateSheetEditor({
  examId,
  classId,
  classCode,
  initial,
  note: initialNote,
  next,
  locked,
}: {
  examId: string;
  classId: string;
  classCode: string;
  initial: PaperRow[];
  note: string;
  next: { href: string; label: string } | null;
  locked: boolean;
}) {
  const t = useTranslations('examHub.setup');
  const leaving = useRef(false);
  const [rows, setRows] = useState(initial);
  const [note, setNote] = useState(initialNote);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial) || note !== initialNote;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!leaving.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (subjectId: string, patch: Partial<PaperRow>) =>
    setRows((rs) => rs.map((r) => (r.subjectId === subjectId ? { ...r, ...patch } : r)));

  const save = async (then?: string) => {
    setError(null);
    setBusy(true);
    const r = await saveDateSheet(
      examId,
      classId,
      rows.map(({ code: _c, name: _n, ...s }) => s),
      note !== initialNote ? note.trim() || null : undefined,
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    leaving.current = true;
    const url = new URL(then ?? window.location.href, window.location.href);
    for (const k of ['error', 'detail', 'new']) url.searchParams.delete(k);
    url.searchParams.set('ok', '1');
    window.location.assign(url.toString());
  };

  return (
    <div>
      <p className="ep-field__help">{t('dateSheetHelp')}</p>
      <div className="ep-xapply">
        <label className="ep-field" htmlFor="ds-start">
          <span className="ep-field__label">{t('starts')}</span>
          <input
            id="ds-start"
            className="ep-input"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="ds-end">
          <span className="ep-field__label">{t('ends')}</span>
          <input
            id="ds-end"
            className="ep-input"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={locked}
          onClick={() =>
            setRows((rs) =>
              rs.map((r) => ({ ...r, startsAt: start || r.startsAt, endsAt: end || r.endsAt })),
            )
          }
        >
          {t('apply')}
        </Button>
        <span className="ep-field__help" style={{ alignSelf: 'center' }}>
          {t('sameTime')}
        </span>
      </div>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={t('dateSheet', { class: classCode })}
      >
        <table className="ep-table ep-table--dense ep-xsubj">
          <caption className="ep-sr-only">{t('dateSheet', { class: classCode })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('subject')}</th>
              <th scope="col">{t('date')}</th>
              <th scope="col">{t('starts')}</th>
              <th scope="col">{t('ends')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subjectId}>
                <th scope="row">
                  {r.name} <span className="ep-meter__text">{r.code}</span>
                </th>
                <td>
                  <input
                    className="ep-input"
                    type="date"
                    aria-label={`${t('date')} · ${r.name}`}
                    value={r.examOn ?? ''}
                    disabled={locked}
                    onChange={(e) => change(r.subjectId, { examOn: e.target.value || null })}
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    type="time"
                    aria-label={`${t('starts')} · ${r.name}`}
                    value={r.startsAt ?? ''}
                    disabled={locked}
                    onChange={(e) => change(r.subjectId, { startsAt: e.target.value || null })}
                  />
                </td>
                <td>
                  <input
                    className="ep-input"
                    type="time"
                    aria-label={`${t('ends')} · ${r.name}`}
                    value={r.endsAt ?? ''}
                    disabled={locked}
                    onChange={(e) => change(r.subjectId, { endsAt: e.target.value || null })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="ep-field" htmlFor="ds-note" style={{ marginTop: 'var(--sp-3)' }}>
        <span className="ep-field__label">{t('note')}</span>
        <textarea
          id="ds-note"
          className="ep-input"
          rows={2}
          maxLength={1000}
          value={note}
          placeholder={t('notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="ep-savebar">
        <p className="ep-savebar__status" data-dirty={dirty ? 'true' : 'false'} role="status">
          {error ? (
            <span className="ep-field__error">{error}</span>
          ) : dirty ? (
            t('dirty')
          ) : (
            t('clean')
          )}
        </p>
        <div className="ep-savebar__actions">
          <Button type="button" onClick={() => void save()} disabled={busy || locked}>
            {busy ? t('saving') : t('saveSheet')}
          </Button>
          {next ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void save(next.href)}
              disabled={busy || locked}
            >
              {next.label}
            </Button>
          ) : null}
          <a
            className="ep-btn ep-btn--ghost"
            href={`/exams/${examId}/date-sheet?classId=${classId}`}
          >
            {t('print')}
          </a>
        </div>
      </div>
    </div>
  );
}
