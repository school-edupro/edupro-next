'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Paper } from '@/lib/admission-papers';
import { STATE_WORDS, type ResultRow } from '@/lib/admission-results';
import { saveResults } from '@/lib/admission-results-actions';

/** What the screen holds for a row: the marks as typed, absent, remark, a decision, a reason. */
type Draft = {
  marks: Record<string, string>;
  absent: boolean;
  remark: string;
  /** the decision on the screen: the present one until changed ('' while waiting: marks only) */
  decision: '' | 'select' | 'hold' | 'reject';
  reason: string;
};
const STATE_TONE = {
  waiting: 'info',
  held: 'warning',
  selected: 'success',
  rejected: 'danger',
  sent_back: 'neutral',
  other: 'neutral',
} as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The results grid (docs/design/57, part 2): a row per candidate with a box per part, Absent, the total,
 * %, below cut-off and where they stand; a decision (Select / Hold) for those waiting here; a decided
 * candidate's marks change only with a reason. Every changed row is saved together.
 */
export function ResultsGrid({
  place,
  paper,
  kind,
  rows,
  canEdit,
  heading,
}: {
  place: { cycleId: string; classId: string; stageId: string };
  paper: Paper;
  kind: 'test' | 'interview';
  rows: ResultRow[];
  canEdit: boolean;
  heading: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // only the rows being changed; the rest show what the server has
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  const base = (r: ResultRow): Draft => ({
    marks: Object.fromEntries(
      paper.parts.map((pt) => [pt.id, r.marks[pt.id] != null ? String(r.marks[pt.id]) : '']),
    ),
    absent: r.absent,
    remark: r.remark ?? '',
    decision: r.current ?? '',
    reason: '',
  });
  const now = (r: ResultRow) => drafts[r.id] ?? base(r);
  const edit = (r: ResultRow, patch: Partial<Draft>) =>
    setDrafts((cur) => ({ ...cur, [r.id]: { ...now(r), ...patch } }));
  const marksChanged = (r: ResultRow, d: Draft) =>
    d.absent !== r.absent ||
    paper.parts.some(
      (pt) => (d.marks[pt.id] ?? '') !== (r.marks[pt.id] != null ? String(r.marks[pt.id]) : ''),
    );
  const decisionChanged = (r: ResultRow, d: Draft) => d.decision !== (r.current ?? '');
  /** a selected or not-selected candidate's change asks why (docs/design/58) */
  const needsReason = (r: ResultRow, d: Draft) =>
    (r.state === 'selected' || r.state === 'rejected') &&
    (marksChanged(r, d) || decisionChanged(r, d));
  const dirty = (r: ResultRow) => {
    const d = drafts[r.id];
    return Boolean(
      d && (marksChanged(r, d) || d.remark !== (r.remark ?? '') || decisionChanged(r, d)),
    );
  };
  /** the total, % and cut-off of what is on the screen */
  const figures = (d: Draft) => {
    const got = paper.parts
      .map((pt) => (d.marks[pt.id] === '' ? null : Number(d.marks[pt.id])))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const total = d.absent || !got.length ? null : round2(got.reduce((n, v) => n + v, 0));
    const percent = total !== null ? round2((total / paper.total) * 100) : null;
    const below =
      total !== null &&
      (paper.parts.some(
        (pt) =>
          pt.passMarks !== null && d.marks[pt.id] !== '' && Number(d.marks[pt.id]) < pt.passMarks,
      ) ||
        (paper.minPercent !== null && percent !== null && percent < paper.minPercent));
    return { total, percent, below };
  };
  const changed = rows.filter(dirty);

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveResults({
        ...place,
        rows: changed.map((row) => {
          const d = now(row);
          return {
            applicationId: row.id,
            marks: Object.fromEntries(
              paper.parts.map((pt) => [
                pt.id,
                d.absent || d.marks[pt.id] === '' ? null : Number(d.marks[pt.id]),
              ]),
            ),
            absent: d.absent,
            remark: d.remark.trim() || null,
            ...(d.decision && decisionChanged(row, d) ? { decision: d.decision } : {}),
            ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
          };
        }),
      });
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      const bad = Object.fromEntries(r.data.errors.map((e) => [e.applicationId, e.error]));
      setFailed(bad);
      // saved rows go back to what the server now has; rows with an error keep what was typed
      setDrafts((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => bad[id])));
      setMsg({
        tone: r.data.errors.length ? 'danger' : 'success',
        text: `${String(r.data.saved)} saved${r.data.errors.length ? `; ${String(r.data.errors.length)} with an error (shown on the row)` : ''}.`,
      });
      router.refresh();
    });

  const part = kind === 'test' ? 'subject' : 'parameter';
  return (
    <section className="ep-card" aria-labelledby="rs-grid-h">
      <h2 id="rs-grid-h" className="ep-card__title">
        {heading}
      </h2>
      {rows.length === 0 ? (
        <p style={{ margin: 0 }}>No candidate here for these filters.</p>
      ) : (
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Results (scrolls sideways)"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Marks by {part}</caption>
            <thead>
              <tr>
                <th scope="col">Roll</th>
                <th scope="col">Candidate</th>
                {paper.parts.map((pt) => (
                  <th key={pt.id} scope="col" className="is-numeric">
                    {pt.name}
                    <div className="ep-field__help" style={{ margin: 0 }}>
                      of {pt.maxMarks}
                      {pt.passMarks !== null ? ` · pass ${String(pt.passMarks)}` : ''}
                    </div>
                  </th>
                ))}
                <th scope="col">Absent</th>
                <th scope="col" className="is-numeric">
                  Total
                </th>
                <th scope="col" className="is-numeric">
                  %
                </th>
                <th scope="col">Stands</th>
                {canEdit ? <th scope="col">Decision</th> : null}
                <th scope="col">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = now(r);
                const f = figures(d);
                const decided = r.state === 'selected' || r.state === 'rejected';
                const open = r.state === 'waiting' || r.state === 'held';
                const locked = !canEdit || r.state === 'other';
                const who = r.candidate ?? r.number ?? 'candidate';
                return (
                  <tr key={r.id}>
                    <td className="ep-num">{r.rollNo ?? '-'}</td>
                    <td>
                      <a href={`/admissions/registrations/${r.id}`}>{who}</a>
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {r.number}
                        {r.slot ? ` · ${r.slot}` : ''}
                      </div>
                      {failed[r.id] ? (
                        <div className="ep-field__error" role="alert">
                          {failed[r.id]}
                        </div>
                      ) : null}
                    </td>
                    {paper.parts.map((pt) => (
                      <td key={pt.id} className="is-numeric">
                        <input
                          className="ep-input"
                          type="number"
                          min={0}
                          max={pt.maxMarks}
                          step="0.5"
                          style={{ width: '5.5rem' }}
                          aria-label={`${pt.name} marks of ${who}`}
                          value={d.absent ? '' : (d.marks[pt.id] ?? '')}
                          disabled={locked || d.absent}
                          onChange={(e) =>
                            edit(r, { marks: { ...d.marks, [pt.id]: e.target.value } })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <label className="ep-check">
                        <input
                          type="checkbox"
                          className="ep-check__input"
                          checked={d.absent}
                          disabled={locked}
                          onChange={(e) => edit(r, { absent: e.target.checked })}
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                        <span className="ep-sr-only">{who} was absent</span>
                      </label>
                    </td>
                    <td className="is-numeric">
                      <strong>{d.absent ? 'AB' : (f.total ?? '-')}</strong>
                    </td>
                    <td className="is-numeric">{f.percent ?? '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Badge tone={STATE_TONE[r.state]}>{STATE_WORDS[r.state]}</Badge>
                      {f.below ? (
                        <>
                          {' '}
                          <Badge tone="warning">Below cut-off</Badge>
                        </>
                      ) : null}
                      {r.level ? (
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          at {r.level}
                        </div>
                      ) : null}
                    </td>
                    {canEdit ? (
                      <td>
                        {open || decided ? (
                          <select
                            className="ep-select"
                            aria-label={`Decision for ${who}`}
                            value={d.decision}
                            disabled={Boolean(decided && r.laterStage)}
                            title={
                              decided && r.laterStage
                                ? `Decided at ${r.laterStage} since: undo it there first`
                                : undefined
                            }
                            onChange={(e) =>
                              edit(r, { decision: e.target.value as Draft['decision'] })
                            }
                          >
                            {r.state === 'waiting' ? <option value="">Marks only</option> : null}
                            <option value="select">Select</option>
                            <option value="hold">Hold</option>
                            <option value="reject">Not selected</option>
                          </select>
                        ) : (
                          <span className="ep-field__help">-</span>
                        )}
                        {needsReason(r, d) ? (
                          <input
                            className="ep-input"
                            style={{ marginTop: 'var(--sp-1)' }}
                            aria-label={`Why ${who}'s marks or decision change`}
                            placeholder="Reason for the change"
                            maxLength={300}
                            value={d.reason}
                            onChange={(e) => edit(r, { reason: e.target.value })}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td>
                      <input
                        className="ep-input"
                        aria-label={`Remark for ${who}`}
                        maxLength={500}
                        value={d.remark}
                        disabled={locked}
                        onChange={(e) => edit(r, { remark: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && rows.length ? (
        <div className="ep-form-actions" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !changed.length}
            onClick={save}
          >
            {pending
              ? 'Saving…'
              : `Save ${changed.length ? String(changed.length) : ''} change${changed.length === 1 ? '' : 's'}`}
          </button>
          {changed.length ? (
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={pending}
              onClick={() => {
                setDrafts({});
                setFailed({});
              }}
            >
              Undo the changes
            </button>
          ) : null}
        </div>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
