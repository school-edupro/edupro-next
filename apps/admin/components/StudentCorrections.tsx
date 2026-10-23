'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ProfileField } from './ProfileField';
import { requestCorrection, withdrawCorrection } from '@/lib/student-correction-actions';
import type { ProfileCatalogue, ProfileValues } from '@/lib/profile';

export interface CorrectionItem {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  changes: Array<{ key: string; label: string; from: string | null; to: string | null }>;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  waitingAt: string | null;
  mine: boolean;
}
export interface CorrectionSetup {
  definitionId: string;
  fields: Array<{ key: string; label: string }>;
  levels: Array<{ level: number; name: string; approvers: string }>;
}

const STATUS: Record<CorrectionItem['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  applied: { label: 'Approved and applied', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const shown = (v: string | null) => v ?? '(blank)';

/**
 * "Correct details": the name parts, date of birth, gender and parents' names change by a request the
 * school's approval levels decide; the history keeps every old and new value (docs/design/37, part 1).
 */
export function StudentCorrections({
  studentId,
  values,
  catalogue,
  setup,
  history,
  canRequest,
  canSetUp,
}: {
  studentId: string;
  values: ProfileValues;
  catalogue: ProfileCatalogue;
  setup: CorrectionSetup;
  history: CorrectionItem[];
  canRequest: boolean;
  canSetUp: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileValues>(values);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const fields = setup.fields
    .map((x) => catalogue.fields.find((f) => f.key === x.key))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));
  const waiting = history.find((x) => x.status === 'pending');
  const changed = fields
    .map((f) => f.key)
    .filter((k) => String(draft[k] ?? '') !== String(values[k] ?? ''));

  const send = () =>
    start(async () => {
      setErrors({});
      const r = await requestCorrection(
        studentId,
        Object.fromEntries(
          changed.map((k) => [k, draft[k] === '' ? null : (draft[k] ?? null)]),
        ) as Record<string, string | null>,
        reason.trim(),
      );
      if (r.ok) {
        setMsg({
          tone: 'success',
          text: 'Sent for approval. The record changes when it is approved.',
        });
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        setErrors(r.errors ?? {});
        setMsg({ tone: 'danger', text: r.error });
      }
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        The name, date of birth, gender and parents’ names change only with approval; the old and
        new values are kept. Decided by{' '}
        {setup.levels.map((l, i) => (
          <span key={l.level}>
            {i ? ', then ' : ''}
            <strong>{l.name}</strong> ({l.approvers})
          </span>
        ))}
        .{' '}
        {canSetUp ? (
          <a
            href={`/workflow/definitions?edit=${setup.definitionId}`}
            style={{ textDecoration: 'underline' }}
          >
            Change who approves
          </a>
        ) : null}
      </p>
      {waiting ? (
        <div className="ep-alert ep-alert--warning" role="status">
          A correction is waiting{waiting.waitingAt ? ` at ${waiting.waitingAt}` : ''}; another can
          be asked once it is decided.
        </div>
      ) : null}
      {canRequest && !waiting ? (
        open ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div className="ep-profile__grid">
              {fields.map((f) => (
                <ProfileField
                  key={f.key}
                  field={f}
                  values={draft}
                  geography={catalogue.geography}
                  error={errors[f.key]}
                  onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))}
                />
              ))}
            </div>
            <label className="ep-field" htmlFor="corr-reason">
              <span className="ep-field__label">Reason (and the document seen)</span>
              <input
                id="corr-reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. as in the birth certificate"
              />
            </label>
            {changed.length ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                Changing:{' '}
                {changed
                  .map((k) => {
                    const f = fields.find((x) => x.key === k);
                    const to = String(draft[k] ?? '');
                    return `${f?.label ?? k}: ${shown(String(values[k] ?? '') || null)} → ${shown((f?.upper ? to.toUpperCase() : to) || null)}`;
                  })
                  .join(' · ')}
                . A parent’s name is shared by brothers and sisters on the same record.
              </p>
            ) : null}
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={pending || !changed.length || reason.trim().length < 3}
                onClick={send}
              >
                Send for approval
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setDraft(values);
                  setErrors({});
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                setDraft(values);
                setMsg(null);
                setOpen(true);
              }}
            >
              Correct details
            </button>
          </div>
        )
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      {history.length ? (
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Correction history</caption>
            <thead>
              <tr>
                <th scope="col">Asked</th>
                <th scope="col">Change</th>
                <th scope="col">Reason</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((x) => (
                <tr key={x.id}>
                  <td>
                    {when(x.requestedAt)}
                    <div className="ep-field__help">{x.requestedBy ?? ''}</div>
                  </td>
                  <td>
                    {x.changes.map((c) => (
                      <div key={c.key}>
                        {c.label}: {shown(c.from)} → <strong>{shown(c.to)}</strong>
                      </div>
                    ))}
                  </td>
                  <td>{x.reason}</td>
                  <td>
                    <span className={`ep-badge ep-badge--${STATUS[x.status].tone}`}>
                      {STATUS[x.status].label}
                    </span>
                    {x.status === 'pending' && x.waitingAt ? (
                      <div className="ep-field__help">At {x.waitingAt}</div>
                    ) : null}
                    {x.decidedAt ? (
                      <div className="ep-field__help">
                        {x.decidedBy ?? ''} {when(x.decidedAt)}
                      </div>
                    ) : null}
                    {x.note ? <div className="ep-field__help">{x.note}</div> : null}
                    {x.applyError ? <div className="ep-field__help">{x.applyError}</div> : null}
                  </td>
                  <td>
                    {x.status === 'pending' && x.mine ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await withdrawCorrection(studentId, x.id);
                            if (r.ok) router.refresh();
                            else setMsg({ tone: 'danger', text: r.error });
                          })
                        }
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
