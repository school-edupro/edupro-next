'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  findStudents,
  previewMerge,
  requestMerge,
  withdrawMerge,
  type MergeOutcome,
  type MergePreview,
  type MergeSide,
} from '@/lib/student-correction-actions';

export interface MergeItem {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  keep: { id: string; name: string; admissionNo: string };
  duplicate: { id: string; name: string; admissionNo: string };
  reason: string;
  preview: MergeOutcome;
  result: MergeOutcome | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  waitingAt: string | null;
  mine: boolean;
}
export interface MergeSetup {
  definitionId: string;
  levels: Array<{ level: number; name: string; approvers: string }>;
}

const STATUS: Record<MergeItem['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  applied: { label: 'Merged', tone: 'success' },
  rejected: { label: 'Not merged', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const rs = (n: number) => `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '—';
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** The two records side by side, then what the merge moves and settles. */
export function MergeOutcomeView({ o }: { o: MergeOutcome }) {
  const rows: Array<[string, (s: MergeSide) => string]> = [
    ['Admission no.', (s) => s.admissionNo],
    ['Name', (s) => s.name],
    ['Date of birth', (s) => dmy(s.dob)],
    ['Father', (s) => s.father ?? '—'],
    ['Mother', (s) => s.mother ?? '—'],
    ['Class', (s) => s.classSection ?? '—'],
    ['Admitted on', (s) => dmy(s.admittedOn)],
    ['Fee due', (s) => rs(s.due)],
  ];
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">The two records</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="ep-sr-only">Detail</span>
              </th>
              <th scope="col">Kept</th>
              <th scope="col">Duplicate (closed)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{get(o.keep)}</td>
                <td>{get(o.duplicate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.moved.length ? (
        <p style={{ margin: 0 }}>
          Moves to the kept record:{' '}
          {o.moved.map((m) => `${m.label} (${String(m.count)})`).join(', ')}.
        </p>
      ) : null}
      {o.clashes.length ? (
        <div>
          <p style={{ margin: 0 }}>Held by both, the kept record’s stays:</p>
          <ul style={{ margin: 0 }}>
            {o.clashes.map((x) => (
              <li key={`${x.area}-${x.rule}`}>
                {x.label}: {x.rule} ({x.count})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p style={{ margin: 0 }}>
        {o.fee.receipts ? `${String(o.fee.receipts)} receipt(s) move. ` : ''}
        {o.fee.freed > 0
          ? `${rs(o.fee.freed)} paid on the duplicate’s fee lines goes to the kept record’s dues${o.fee.advance > 0 ? `; ${rs(o.fee.advance)} is left as advance` : ''}. `
          : ''}
        Fee due after the merge: <strong>{rs(o.fee.dueAfter)}</strong>.
        {o.logins === 'moved'
          ? ' The duplicate’s pupil login moves to the kept record.'
          : o.logins === 'stopped'
            ? ' The duplicate’s pupil login stops.'
            : ''}
      </p>
    </div>
  );
}

/**
 * "Merge a duplicate record" (docs/design/37, part 3): find the other record of the same child, choose
 * which one stays, see what moves and what clashes, then the approval levels decide. Cannot be undone.
 */
export function StudentMerge({
  student,
  setup,
  history,
  canRequest,
  canSetUp,
}: {
  student: { id: string; name: string; admissionNo: string };
  setup: MergeSetup;
  history: MergeItem[];
  canRequest: boolean;
  canSetUp: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof findStudents>> | null>(null);
  const [other, setOther] = useState<{ id: string; name: string; admissionNo: string } | null>(
    null,
  );
  const [keepThis, setKeepThis] = useState(true);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const waiting = history.find((x) => x.status === 'pending');
  const pair = () =>
    other
      ? keepThis
        ? { keepId: student.id, duplicateId: other.id }
        : { keepId: other.id, duplicateId: student.id }
      : null;
  const reset = () => {
    setPreview(null);
    setMsg(null);
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        The same child admitted twice? Everything of the duplicate (fees and receipts, attendance,
        marks, library, documents, parents, transport, hostel) moves to the record kept; where both
        hold the same thing the kept record’s stays. The duplicate is closed and its admission
        number still finds the pupil. A merge cannot be undone. Decided by{' '}
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
          A merge with this record is waiting{waiting.waitingAt ? ` at ${waiting.waitingAt}` : ''}.
        </div>
      ) : null}
      {canRequest && !waiting ? (
        open ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div className="ep-rp__row" style={{ alignItems: 'flex-end' }}>
              <label className="ep-field" htmlFor={`${uid}-q`} style={{ flex: 1 }}>
                <span className="ep-field__label">The other record: admission no. or name</span>
                <input
                  id={`${uid}-q`}
                  className="ep-input"
                  value={q}
                  maxLength={80}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      start(async () => setFound(await findStudents(q)));
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                disabled={pending || q.trim().length < 2}
                onClick={() => start(async () => setFound(await findStudents(q)))}
              >
                Find
              </button>
            </div>
            {found ? (
              found.filter((f) => f.id !== student.id).length ? (
                <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="ep-field__label">Choose the other record</legend>
                  {found
                    .filter((f) => f.id !== student.id)
                    .map((f) => (
                      <label key={f.id} className="ep-radio">
                        <input
                          type="radio"
                          className="ep-radio__input"
                          name={`${uid}-other`}
                          checked={other?.id === f.id}
                          onChange={() => {
                            setOther(f);
                            reset();
                          }}
                        />
                        <span className="ep-radio__dot" aria-hidden="true" />
                        <span className="ep-check__text">
                          {f.name} · {f.admissionNo}
                          {f.section ? ` · ${f.section}` : ''}
                        </span>
                      </label>
                    ))}
                </fieldset>
              ) : (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  No other record found.
                </p>
              )
            ) : null}
            {other ? (
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">Which record stays?</legend>
                {[
                  [true, `This one: ${student.name} (${student.admissionNo})`],
                  [false, `The other: ${other.name} (${other.admissionNo})`],
                ].map(([v, label]) => (
                  <label key={String(v)} className="ep-radio">
                    <input
                      type="radio"
                      className="ep-radio__input"
                      name={`${uid}-keep`}
                      checked={keepThis === v}
                      onChange={() => {
                        setKeepThis(v as boolean);
                        reset();
                      }}
                    />
                    <span className="ep-radio__dot" aria-hidden="true" />
                    <span className="ep-check__text">{label as string}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={pending || !other}
                onClick={() =>
                  start(async () => {
                    setMsg(null);
                    const r = await previewMerge(pair()!);
                    if (r.ok) setPreview(r.data);
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                See what changes
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setOther(null);
                  setFound(null);
                  reset();
                }}
              >
                Cancel
              </button>
            </div>
            {preview?.blockers.length ? (
              <div className="ep-alert ep-alert--danger" role="alert">
                Not possible now:
                <ul style={{ margin: 0 }}>
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview?.outcome ? (
              <>
                <MergeOutcomeView o={preview.outcome} />
                <label className="ep-field" htmlFor={`${uid}-reason`}>
                  <span className="ep-field__label">Reason</span>
                  <input
                    id={`${uid}-reason`}
                    className="ep-input"
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    placeholder="e.g. admitted twice: same birth certificate and parents"
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="ep-form-actions">
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() =>
                      start(async () => {
                        const r = await requestMerge({ ...pair()!, reason: reason.trim() });
                        if (r.ok) {
                          setMsg({
                            tone: 'success',
                            text: 'Sent for approval. The records merge when it is approved.',
                          });
                          setOpen(false);
                          setPreview(null);
                          router.refresh();
                        } else setMsg({ tone: 'danger', text: r.error });
                      })
                    }
                  >
                    Send for approval
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => {
                setMsg(null);
                setOpen(true);
              }}
            >
              Merge a duplicate record
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
        <ul className="ep-rp__events">
          {history.map((x) => (
            <li key={x.id}>
              <span className={`ep-badge ep-badge--${STATUS[x.status].tone}`}>
                {STATUS[x.status].label}
              </span>{' '}
              {x.duplicate.name} ({x.duplicate.admissionNo}) into{' '}
              <strong>
                {x.keep.name} ({x.keep.admissionNo})
              </strong>{' '}
              · {x.reason}
              <div className="ep-field__help">
                Asked by {x.requestedBy ?? ''} {when(x.requestedAt)}
                {x.status === 'pending' && x.waitingAt ? ` · at ${x.waitingAt}` : ''}
                {x.decidedAt ? ` · decided by ${x.decidedBy ?? ''} ${when(x.decidedAt)}` : ''}
                {x.note ? ` · ${x.note}` : ''}
              </div>
              {x.applyError ? <div className="ep-field__help">{x.applyError}</div> : null}
              <details>
                <summary>{x.result ? 'What it did' : 'What it would do'}</summary>
                <MergeOutcomeView o={x.result ?? x.preview} />
              </details>
              {x.status === 'pending' && x.mine ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await withdrawMerge(x.id, student.id);
                      if (r.ok) router.refresh();
                      else setMsg({ tone: 'danger', text: r.error });
                    })
                  }
                >
                  Withdraw
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
