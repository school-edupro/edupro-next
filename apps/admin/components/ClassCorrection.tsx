'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  previewClassCorrection,
  requestClassCorrection,
  withdrawClassCorrection,
  type ClassOutcome,
} from '@/lib/student-correction-actions';

export interface ClassCorrectionItem {
  id: string;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn';
  from: string;
  to: string;
  effectiveFrom: string;
  reason: string;
  preview: ClassOutcome;
  result: ClassOutcome | null;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  applyError: string | null;
  waitingAt: string | null;
  mine: boolean;
}
export interface ClassCorrectionSetup {
  definitionId: string;
  levels: Array<{ level: number; name: string; approvers: string }>;
  sections: Array<{ id: string; label: string; classId: string }>;
}

const STATUS: Record<ClassCorrectionItem['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  applied: { label: 'Approved and done', tone: 'success' },
  rejected: { label: 'Not done', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
const rs = (n: number) =>
  `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** What a class correction does to the fees: the totals, the advance and the lines that change. */
export function ClassOutcomeView({ o }: { o: ClassOutcome }) {
  const f = o.fee;
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <p style={{ margin: 0 }}>
        {o.from.label} → <strong>{o.to.label}</strong>, roll no. {o.rollNo}, from{' '}
        {dmy(o.effectiveFrom)}. Attendance and marks stay with the pupil.
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table">
          <caption className="ep-sr-only">Fee for the year, before and after</caption>
          <thead>
            <tr>
              <th scope="col">Fee for the year</th>
              <th scope="col">Charged</th>
              <th scope="col">Paid</th>
              <th scope="col">Due</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Now ({o.from.label})</th>
              <td>{rs(f.before.charged)}</td>
              <td>{rs(f.before.paid)}</td>
              <td>{rs(f.before.due)}</td>
            </tr>
            <tr>
              <th scope="row">After ({o.to.label})</th>
              <td>{rs(f.after.charged)}</td>
              <td>{rs(f.after.paid)}</td>
              <td>
                <strong>{rs(f.after.due)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {f.freed > 0 && (f.lines.length > 0 || f.advance > 0) ? (
        <p style={{ margin: 0 }}>
          {rs(f.freed)} paid on the old class’s fee from the date is set against the new fee
          {f.advance > 0 ? (
            <>
              ; <strong>{rs(f.advance)}</strong> is left as advance on the receipt (given back on
              request as a refund)
            </>
          ) : null}
          .
        </p>
      ) : null}
      {f.kept.length ? (
        <p className="ep-field__help" style={{ margin: 0 }}>
          Left as they are: {f.kept.map((k) => `${k.period} ${k.head} (${k.why})`).join('; ')}.
        </p>
      ) : null}
      {f.lines.length ? (
        <details>
          <summary>
            {f.lines.length} fee line{f.lines.length === 1 ? '' : 's'} change
          </summary>
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Fee lines that change</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Head</th>
                  <th scope="col">Now</th>
                  <th scope="col">After</th>
                  <th scope="col">Paid after</th>
                </tr>
              </thead>
              <tbody>
                {f.lines.map((l) => (
                  <tr key={`${l.period}-${l.head}-${l.ledger}`}>
                    <td>{l.period}</td>
                    <td>{l.head}</td>
                    <td>{l.before === null ? 'Not charged' : rs(l.before)}</td>
                    <td>{l.after === null ? 'Not charged' : rs(l.after)}</td>
                    <td>{rs(l.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : (
        <p className="ep-field__help" style={{ margin: 0 }}>
          No fee line changes.
        </p>
      )}
    </div>
  );
}

/**
 * "Correct class" (docs/design/37, part 2): the right class-section and the date it applies from, a
 * preview of what happens to the fees, then the approval levels decide; the history keeps each request.
 */
export function ClassCorrection({
  studentId,
  currentSectionId,
  setup,
  history,
  canRequest,
  canSetUp,
}: {
  studentId: string;
  currentSectionId: string | null;
  setup: ClassCorrectionSetup;
  history: ClassCorrectionItem[];
  canRequest: boolean;
  canSetUp: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ClassOutcome | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const currentClass = setup.sections.find((s) => s.id === currentSectionId)?.classId;
  const choices = setup.sections.filter((s) => s.classId !== currentClass);
  const picked = choices.find((s) => s.label.toLowerCase() === section.trim().toLowerCase());
  const waiting = history.find((x) => x.status === 'pending');
  const body = () => ({
    toSectionId: picked!.id,
    ...(date ? { effectiveFrom: date } : {}),
  });

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <p style={{ margin: 0 }}>
        Admitted to the wrong class? The pupil moves to the right class from a date (the admission
        date unless you choose another); the fee is made again at that class’s rates and money paid
        is set against it. Decided by{' '}
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
          A class correction is waiting{waiting.waitingAt ? ` at ${waiting.waitingAt}` : ''}.
        </div>
      ) : null}
      {canRequest && !waiting && currentSectionId ? (
        open ? (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div className="ep-profile__grid">
              <label className="ep-field" htmlFor={`${uid}-section`}>
                <span className="ep-field__label">Right class and section</span>
                <input
                  id={`${uid}-section`}
                  className="ep-input"
                  list={`${uid}-sections`}
                  autoComplete="off"
                  placeholder="Type to search"
                  value={section}
                  onChange={(e) => {
                    setSection(e.target.value);
                    setPreview(null);
                  }}
                />
                <datalist id={`${uid}-sections`}>
                  {choices.map((s) => (
                    <option key={s.id} value={s.label} />
                  ))}
                </datalist>
              </label>
              <label className="ep-field" htmlFor={`${uid}-date`}>
                <span className="ep-field__label">From</span>
                <input
                  id={`${uid}-date`}
                  className="ep-input"
                  type="date"
                  value={date}
                  aria-describedby={`${uid}-date-help`}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPreview(null);
                  }}
                />
                <span id={`${uid}-date-help`} className="ep-field__help">
                  Blank: the admission date. Months before keep the old class’s fee.
                </span>
              </label>
            </div>
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={pending || !picked}
                onClick={() =>
                  start(async () => {
                    setMsg(null);
                    const r = await previewClassCorrection(studentId, body());
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
                  setPreview(null);
                }}
              >
                Cancel
              </button>
            </div>
            {preview ? (
              <>
                <ClassOutcomeView o={preview} />
                <label className="ep-field" htmlFor={`${uid}-reason`}>
                  <span className="ep-field__label">Reason</span>
                  <input
                    id={`${uid}-reason`}
                    className="ep-input"
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    placeholder="e.g. the admission form asked for Class VI"
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
                        const r = await requestClassCorrection(studentId, {
                          ...body(),
                          reason: reason.trim(),
                        });
                        if (r.ok) {
                          setMsg({
                            tone: 'success',
                            text: 'Sent for approval. The pupil moves when it is approved.',
                          });
                          setOpen(false);
                          setPreview(null);
                          setReason('');
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
              Correct class
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
              {x.from} → <strong>{x.to}</strong> from {dmy(x.effectiveFrom)} · {x.reason}
              <div className="ep-field__help">
                Asked by {x.requestedBy ?? ''} {when(x.requestedAt)}
                {x.status === 'pending' && x.waitingAt ? ` · at ${x.waitingAt}` : ''}
                {x.decidedAt ? ` · decided by ${x.decidedBy ?? ''} ${when(x.decidedAt)}` : ''}
                {x.note ? ` · ${x.note}` : ''}
              </div>
              {x.applyError ? <div className="ep-field__help">{x.applyError}</div> : null}
              <details>
                <summary>{x.result ? 'What it did' : 'What it would do'}</summary>
                <ClassOutcomeView o={x.result ?? x.preview} />
              </details>
              {x.status === 'pending' && x.mine ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await withdrawClassCorrection(studentId, x.id);
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
