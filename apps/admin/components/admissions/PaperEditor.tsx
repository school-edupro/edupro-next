'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Paper, PapersView } from '@/lib/admission-papers';
import { copyPaper, savePaper } from '@/lib/admission-papers-actions';

type Row = { key: string; id?: string; name: string; maxMarks: string; passMarks: string };
let seq = 0;
const rowOf = (p?: { id?: string; name: string; maxMarks: number; passMarks: number | null }) => ({
  key: `r${String(++seq)}`,
  ...(p?.id ? { id: p.id } : {}),
  name: p?.name ?? '',
  maxMarks: p ? String(p.maxMarks) : '',
  passMarks: p?.passMarks !== null && p?.passMarks !== undefined ? String(p.passMarks) : '',
});

/**
 * One class's paper for a Test or Interview stage (docs/design/57, part 1): its parts in order with
 * maximum marks and an optional pass mark, the minimum total %, saved together; copied to other
 * classes. No parts: the class takes one marks figure out of the stage's maximum.
 */
export function PaperEditor({
  stage,
  classId,
  className,
  paper,
  picks,
  others,
  canEdit,
}: {
  stage: PapersView['stage'];
  classId: string;
  className: string;
  paper: Paper | null;
  picks: string[];
  others: Array<{ id: string; name: string; has: boolean }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => (paper?.parts ?? []).map((p) => rowOf(p)));
  const [minPercent, setMinPercent] = useState(
    paper?.minPercent !== null && paper?.minPercent !== undefined ? String(paper.minPercent) : '',
  );
  const [targets, setTargets] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const isTest = stage.kind === 'test';
  const part = isTest ? 'Subject' : 'Parameter';
  const total = rows.reduce((n, r) => n + (Number(r.maxMarks) > 0 ? Number(r.maxMarks) : 0), 0);
  const listId = `paper-picks-${classId}`;

  const set = (i: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((cur) => {
      const next = [...cur];
      const [r] = next.splice(i, 1);
      next.splice(i + by, 0, r!);
      return next;
    });
  /** what is wrong before saving, in words */
  const problem = (): string | null => {
    const names = new Set<string>();
    for (const r of rows) {
      const n = r.name.trim();
      if (!n) return `Give every ${part.toLowerCase()} a name.`;
      if (names.has(n.toLowerCase())) return `Two ${part.toLowerCase()}s are called ${n}.`;
      names.add(n.toLowerCase());
      const max = Number(r.maxMarks);
      if (!(max > 0) || max > 1000) return `${n}: the maximum is from 1 to 1000.`;
      if (r.passMarks !== '' && !(Number(r.passMarks) >= 0 && Number(r.passMarks) <= max))
        return `${n}: the pass mark is from 0 to ${String(max)}.`;
    }
    if (minPercent !== '' && !(Number(minPercent) > 0 && Number(minPercent) <= 100))
      return 'The minimum total % is from 1 to 100.';
    return null;
  };
  const save = () => {
    const p = problem();
    if (p) return setMsg({ tone: 'danger', text: p });
    start(async () => {
      setMsg(null);
      const r = await savePaper(stage.id, classId, {
        minPercent: rows.length && minPercent !== '' ? Number(minPercent) : null,
        parts: rows.map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          name: x.name.trim(),
          maxMarks: Number(x.maxMarks),
          passMarks: x.passMarks === '' ? null : Number(x.passMarks),
        })),
      });
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setRows((r.data.paper?.parts ?? []).map((x) => rowOf(x)));
      setMsg({
        tone: 'success',
        text: r.data.paper
          ? `Saved: ${className} is marked out of ${String(r.data.paper.total)}.`
          : `Saved: ${className} has no paper; it takes one figure out of ${String(stage.maxMarks ?? '-')}.`,
      });
      router.refresh();
    });
  };
  const copy = () =>
    start(async () => {
      setMsg(null);
      const r = await copyPaper(stage.id, classId, targets);
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      setTargets([]);
      setMsg({
        tone: 'success',
        text: `Copied to ${String(r.data.copied)} class${r.data.copied === 1 ? '' : 'es'}.`,
      });
      router.refresh();
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <p className="ep-field__help" style={{ margin: 0 }}>
        {rows.length
          ? `${className} is marked out of ${String(total)}: the sum of its ${part.toLowerCase()}s.`
          : `No paper: ${className} takes one marks figure out of the stage's ${String(stage.maxMarks ?? '-')}. Add ${isTest ? 'subjects' : 'parameters'} to mark it part by part.`}
      </p>
      <datalist id={listId}>
        {picks.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {rows.length ? (
        <ol
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--sp-3)' }}
        >
          {rows.map((r, i) => (
            <li key={r.key} className="ep-papers__row">
              <label className="ep-field">
                <span className="ep-field__label">
                  {part} {i + 1}
                </span>
                <input
                  className="ep-input"
                  list={listId}
                  maxLength={60}
                  value={r.name}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Maximum</span>
                <input
                  className="ep-input"
                  type="number"
                  min={1}
                  max={1000}
                  step="0.5"
                  value={r.maxMarks}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { maxMarks: e.target.value })}
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Pass mark</span>
                <input
                  className="ep-input"
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="None"
                  value={r.passMarks}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { passMarks: e.target.value })}
                />
              </label>
              {canEdit ? (
                <span className="ep-papers__tools">
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={i === 0}
                    aria-label={`Move ${r.name || `${part.toLowerCase()} ${String(i + 1)}`} up`}
                    onClick={() => move(i, -1)}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={i === rows.length - 1}
                    aria-label={`Move ${r.name || `${part.toLowerCase()} ${String(i + 1)}`} down`}
                    onClick={() => move(i, 1)}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    aria-label={`Remove ${r.name || `${part.toLowerCase()} ${String(i + 1)}`}`}
                    onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {canEdit ? (
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={rows.length >= 30}
            onClick={() => setRows((cur) => [...cur, rowOf()])}
          >
            Add a {part.toLowerCase()}
          </button>
        </div>
      ) : null}
      {rows.length ? (
        <label className="ep-field" style={{ maxWidth: '18rem', margin: 0 }}>
          <span className="ep-field__label">Minimum total % (optional)</span>
          <input
            className="ep-input"
            type="number"
            min={1}
            max={100}
            step="0.5"
            placeholder="None"
            value={minPercent}
            disabled={!canEdit}
            onChange={(e) => setMinPercent(e.target.value)}
          />
          <span className="ep-field__help">
            Below it, or below a pass mark, the candidate is flagged &quot;below cut-off&quot;.
            Nobody is rejected by it.
          </span>
        </label>
      ) : null}
      {msg ? (
        <p
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ margin: 0 }}
        >
          {msg.text}
        </p>
      ) : null}
      {canEdit && (rows.length || paper) ? (
        <div className="ep-form-actions" style={{ margin: 0 }}>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save the paper'}
          </button>
        </div>
      ) : null}
      {canEdit && paper && others.length ? (
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">Copy this paper to</legend>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The saved paper of {className} replaces the parts of the classes ticked.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2) var(--sp-4)' }}>
            {others.map((k) => (
              <label key={k.id} className="ep-check">
                <input
                  type="checkbox"
                  className="ep-check__input"
                  checked={targets.includes(k.id)}
                  onChange={(e) =>
                    setTargets((cur) =>
                      e.target.checked ? [...cur, k.id] : cur.filter((x) => x !== k.id),
                    )
                  }
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span>
                  {k.name}
                  {k.has ? ' (has a paper)' : ''}
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending || !targets.length}
              onClick={copy}
            >
              Copy to {targets.length || ''} class{targets.length === 1 ? '' : 'es'}
            </button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
