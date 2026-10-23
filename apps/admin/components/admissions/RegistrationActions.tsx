'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  decideRegistration,
  sendBackRegistration,
  undoRegistration,
} from '@/lib/admission-process-actions';

type Kind = 'document_check' | 'test' | 'interview' | 'interaction' | 'selection' | 'custom';
type Decision = 'approve' | 'reject' | 'hold' | 'offer' | 'waitlist';

/**
 * What the approver does on a registration (docs/design/39, part 4): the decision of the level it waits
 * at — with the fee category at Document check, attendance and marks at a test or interview, offer or
 * waiting list at Selection —, sending the form back for correction, and undoing.
 */
export function RegistrationActions({
  id,
  current,
  canAct,
  categories,
  categoryId,
  fields,
  undoable,
  steps,
  isAdmin,
}: {
  id: string;
  current: {
    name: string;
    kind: Kind;
    maxMarks: number | null;
    level: number;
    levels: number;
    levelName: string;
    last: boolean;
  } | null;
  canAct: boolean;
  categories: Array<{ id: string; name: string }>;
  categoryId: string | null;
  fields: Array<{ key: string; label: string }>;
  undoable: boolean;
  steps: Array<{ name: string; state: string }>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [marks, setMarks] = useState('');
  const [attendance, setAttendance] = useState<'present' | 'absent'>('present');
  const [cat, setCat] = useState(categoryId ?? '');
  const [mode, setMode] = useState<'decide' | 'send' | 'undo'>('decide');
  const [picked, setPicked] = useState<string[]>([]);
  const [find, setFind] = useState('');
  const [remark, setRemark] = useState('');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const [toStep, setToStep] = useState('');
  const [showUndo, setShowUndo] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        setRemarks('');
        setMarks('');
        setReason('');
        setMode('decide');
        router.refresh();
      } else setError(r.error ?? 'Not saved');
    });
  const decide = (decision: Decision) =>
    run(() =>
      decideRegistration(id, {
        decision,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        ...(current?.kind === 'test' || current?.kind === 'interview'
          ? { attendance, marks: attendance === 'absent' || marks === '' ? null : Number(marks) }
          : {}),
        ...(current?.kind === 'document_check' && cat ? { categoryId: cat } : {}),
      }),
    );
  const marksStage = current?.kind === 'test' || current?.kind === 'interview';

  return (
    <div className="ep-rp__act">
      {current ? (
        <p style={{ margin: 0 }}>
          Waiting at <strong>{current.name}</strong>
          {current.levels > 1
            ? ` · level ${String(current.level)} of ${String(current.levels)} (${current.levelName})`
            : ''}
        </p>
      ) : null}
      {current && !canAct ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          The people of &ldquo;{current.levelName}&rdquo; decide here.
        </p>
      ) : null}
      {current && canAct ? (
        <div
          className="ep-pills"
          role="tablist"
          aria-label="What to do"
          style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          {(
            [
              ['decide', 'Decide'],
              ['send', 'Send back for correction'],
              ...(undoable ? ([['undo', 'Undo']] as const) : []),
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              className={`ep-btn ep-btn--sm ${mode === k ? 'ep-btn--secondary' : 'ep-btn--ghost'}`}
              onClick={() => setMode(k)}
            >
              {l}
            </button>
          ))}
        </div>
      ) : null}

      {current && canAct && mode === 'decide' ? (
        <div className="ep-rp__act">
          {current.kind === 'document_check' ? (
            <label className="ep-field">
              <span className="ep-field__label">Fee category</span>
              <select className="ep-select" value={cat} onChange={(e) => setCat(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">
                Taken from the form; change it if the papers show otherwise.
              </span>
            </label>
          ) : null}
          {marksStage ? (
            <div className="ep-rp__row">
              <label className="ep-field">
                <span className="ep-field__label">Attendance</span>
                <select
                  className="ep-select"
                  value={attendance}
                  onChange={(e) => setAttendance(e.target.value as 'present' | 'absent')}
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                </select>
              </label>
              {attendance === 'present' ? (
                <label className="ep-field">
                  <span className="ep-field__label">
                    Marks{current.maxMarks ? ` (out of ${String(current.maxMarks)})` : ''}
                  </span>
                  <input
                    className="ep-input"
                    type="number"
                    min={0}
                    max={current.maxMarks ?? undefined}
                    step="0.5"
                    value={marks}
                    onChange={(e) => setMarks(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">Remarks</span>
            <textarea
              className="ep-input"
              rows={2}
              maxLength={1000}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <div className="ep-form-actions">
            {current.kind === 'selection' && current.last ? (
              <>
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending}
                  onClick={() => decide('offer')}
                >
                  Offer admission
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  disabled={pending}
                  onClick={() => decide('waitlist')}
                >
                  Waiting list
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending}
                onClick={() => decide('approve')}
              >
                Approve
              </button>
            )}
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              disabled={pending}
              onClick={() => decide('hold')}
            >
              Hold
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--danger"
              disabled={pending}
              onClick={() => decide('reject')}
            >
              Not selected
            </button>
          </div>
        </div>
      ) : null}

      {current && canAct && mode === 'send' ? (
        <div className="ep-rp__act">
          <p className="ep-field__help" style={{ margin: 0 }}>
            Mark what the family must correct. They are emailed, can change only these answers, and
            the form comes back to this level when they submit again.
          </p>
          <input
            className="ep-input"
            type="search"
            aria-label="Find a question"
            placeholder="Find a question"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          <div className="ep-rp__fields">
            {fields
              .filter(
                (f) => picked.includes(f.key) || f.label.toLowerCase().includes(find.toLowerCase()),
              )
              .map((f) => (
                <label key={f.key} className="ep-check">
                  <input
                    type="checkbox"
                    className="ep-check__input"
                    checked={picked.includes(f.key)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked ? [...picked, f.key] : picked.filter((x) => x !== f.key),
                      )
                    }
                  />
                  <span className="ep-check__box" aria-hidden="true" />
                  <span className="ep-check__text">{f.label}</span>
                </label>
              ))}
          </div>
          <label className="ep-field">
            <span className="ep-field__label">Remark to the family</span>
            <textarea
              className="ep-input"
              rows={2}
              maxLength={1000}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Correct by</span>
            <input
              className="ep-input"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending || !picked.length || remark.trim().length < 3}
              onClick={() =>
                run(() =>
                  sendBackRegistration(id, {
                    fields: picked,
                    remark: remark.trim(),
                    ...(due ? { dueOn: due } : {}),
                  }),
                )
              }
            >
              Send to the family ({picked.length})
            </button>
          </div>
        </div>
      ) : null}

      {undoable && (!current || !canAct) && !showUndo ? (
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => setShowUndo(true)}
          >
            Undo a decision…
          </button>
        </div>
      ) : null}

      {undoable && (mode === 'undo' || showUndo) ? (
        <div className="ep-rp__act">
          <label className="ep-field">
            <span className="ep-field__label">Reason to undo</span>
            <input
              className="ep-input"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {isAdmin ? (
            <label className="ep-field">
              <span className="ep-field__label">Undo</span>
              <select
                className="ep-select"
                value={toStep}
                onChange={(e) => setToStep(e.target.value)}
              >
                <option value="">The last decision only</option>
                {steps.map((s, i) =>
                  s.state === 'done' || s.state === 'current' || s.state === 'rejected' ? (
                    <option key={i} value={String(i)}>
                      Back to step {i + 1}: {s.name} (every decision from it)
                    </option>
                  ) : null,
                )}
              </select>
            </label>
          ) : null}
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                run(() =>
                  undoRegistration(id, {
                    reason: reason.trim(),
                    ...(toStep !== '' ? { toStep: Number(toStep) } : {}),
                  }),
                )
              }
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
