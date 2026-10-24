'use client';
import { Badge } from '@edupro/ui';
import { useState, useTransition } from 'react';
import { checkRegistrationPoints } from '@/lib/admission-setup-actions';
import type { RegistrationPoints } from '@/lib/admission-setup';

type Line = RegistrationPoints['lines'][number];

/**
 * A registration's merit points (docs/design/40, part 3): each criterion with what the answers gave
 * and what counts. The office confirms them at Document check and may award a criterion differently
 * with a reason; confirmed points stop following criteria changes until worked out again.
 */
export function RegistrationPointsCheck({
  id,
  initial,
  merit,
  canEdit,
}: {
  id: string;
  initial: RegistrationPoints;
  merit: number | null;
  canEdit: boolean;
}) {
  const [points, setPoints] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Line[]>(initial.lines);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const total = (l: Line[]) => Math.round(l.reduce((n, x) => n + x.points, 0) * 100) / 100;
  const set = (i: number, patch: Partial<Line>) =>
    setDraft((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const run = (action: 'confirm' | 'recalculate') =>
    start(async () => {
      const r = await checkRegistrationPoints(
        id,
        action,
        action === 'confirm'
          ? draft.map((l) => ({
              name: l.name,
              points: l.points,
              ...(l.points !== l.auto ? { reason: l.reason ?? '' } : {}),
            }))
          : [],
      );
      if (r.ok && r.data) {
        setPoints(r.data);
        setDraft(r.data.lines);
        setEditing(false);
        setMsg({
          tone: 'success',
          text: action === 'confirm' ? 'Points confirmed.' : 'Points worked out again.',
        });
      } else setMsg({ tone: 'danger', text: r.ok ? 'No points for this class.' : r.error });
    });

  const shown = editing ? draft : points.lines;
  return (
    <div className="ep-rpts">
      <p className="ep-rpts__sum">
        <strong>{editing ? total(draft) : points.total} points</strong>
        {merit !== null && !editing ? (
          <span className="ep-field__help"> · merit with marks {merit}</span>
        ) : null}{' '}
        {points.confirmedAt ? (
          <Badge tone="success">
            Confirmed{points.confirmedBy ? ` by ${points.confirmedBy}` : ''}
          </Badge>
        ) : (
          <Badge tone="warning">Not checked yet</Badge>
        )}
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Merit points by criterion</caption>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">From the answers</th>
              <th scope="col">Counts</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={l.name}>
                <th scope="row">
                  {l.name} <span className="ep-field__help">({l.max})</span>
                </th>
                <td>{l.auto}</td>
                <td>
                  {editing ? (
                    <input
                      className="ep-input ep-rpts__num"
                      inputMode="decimal"
                      aria-label={`Points for ${l.name}`}
                      value={Number.isNaN(l.points) ? '' : l.points}
                      onChange={(e) => {
                        const t = e.target.value.replace(/[^\d.-]/g, '');
                        set(i, { points: t === '' || t === '-' ? Number.NaN : Number(t) });
                      }}
                    />
                  ) : (
                    <strong>{l.points}</strong>
                  )}
                </td>
                <td>
                  {editing && l.points !== l.auto ? (
                    <input
                      className="ep-input"
                      aria-label={`Why ${l.name} counts ${String(l.points)}`}
                      maxLength={300}
                      placeholder="Reason (needed)"
                      value={l.reason ?? ''}
                      onChange={(e) => set(i, { reason: e.target.value })}
                    />
                  ) : (
                    (l.reason ?? '')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </p>
      ) : null}
      {canEdit ? (
        <div className="ep-rpts__actions">
          {editing ? (
            <>
              <button
                type="button"
                className="ep-btn ep-btn--primary ep-btn--sm"
                disabled={pending || draft.some((l) => Number.isNaN(l.points))}
                onClick={() => run('confirm')}
              >
                {pending ? 'Saving…' : 'Confirm these points'}
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => {
                  setDraft(points.lines);
                  setEditing(false);
                  setMsg(null);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ep-btn ep-btn--primary ep-btn--sm"
                onClick={() => {
                  setDraft(points.lines);
                  setEditing(true);
                  setMsg(null);
                }}
              >
                {points.confirmedAt ? 'Change points' : 'Check and confirm'}
              </button>
              {points.confirmedAt ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Work the points out again from the answers? The office’s awards and the confirmation are cleared.',
                      )
                    )
                      run('recalculate');
                  }}
                >
                  Work out again
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
