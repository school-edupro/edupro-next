'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  admitRegistration,
  cancelRegistration,
  collectAdmissionFee,
} from '@/lib/admission-admit-actions';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * The office's part after the offer (docs/design/39, part 6): the admission fee at the counter (or
 * confirming a zero fee), Admit with a class-section and roll number, and cancellation with the refund
 * of the admission fee less the session's deduction.
 */
export function RegistrationOffice({
  id,
  status,
  admissionFee,
  sections,
  refund,
  canCollect,
  canAdmit,
  canCancel,
}: {
  id: string;
  status: string;
  admissionFee: number;
  sections: Array<{ id: string; name: string; capacity: number | null; enrolled: number }>;
  refund: { paid: number; pct: number; deduction: number; amount: number } | null;
  canCollect: boolean;
  canAdmit: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [roll, setRoll] = useState('');
  const [reason, setReason] = useState('');
  const [askCancel, setAskCancel] = useState(false);
  const done = (text: string) => {
    setMsg({ tone: 'success', text });
    router.refresh();
  };

  return (
    <div className="ep-rp__act">
      {status === 'offered' && canCollect ? (
        <section className="ep-rp__act" aria-label="Admission fee">
          <p style={{ margin: 0 }}>
            {admissionFee > 0 ? (
              <>
                Admission fee due: <strong>{rupees(admissionFee)}</strong>
              </>
            ) : (
              'No admission fee is due for this category: confirm the admission to give the admission number.'
            )}
          </p>
          {admissionFee > 0 ? (
            <div className="ep-rp__row">
              <label className="ep-field">
                <span className="ep-field__label">Mode</span>
                <select
                  className="ep-select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="dd">Demand draft</option>
                  <option value="bank">Bank transfer</option>
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Reference / cheque no.</span>
                <input
                  className="ep-input"
                  maxLength={80}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await collectAdmissionFee(id, {
                    mode,
                    ...(reference.trim()
                      ? ['cheque', 'dd'].includes(mode)
                        ? { instrumentNo: reference.trim() }
                        : { reference: reference.trim() }
                      : {}),
                  });
                  if (r.ok)
                    done(
                      `Admission no. ${r.data.admissionNo}${r.data.receiptNo ? `; receipt ${r.data.receiptNo}` : ''}.`,
                    );
                  else setMsg({ tone: 'danger', text: r.error });
                })
              }
            >
              {admissionFee > 0 ? `Take ${rupees(admissionFee)}` : 'Confirm the admission'}
            </button>
          </div>
        </section>
      ) : null}

      {status === 'fee_paid' && canAdmit ? (
        <section className="ep-rp__act" aria-label="Admit">
          {sections.length ? (
            <>
              <div className="ep-rp__row">
                <label className="ep-field">
                  <span className="ep-field__label">Class-section</span>
                  <select
                    className="ep-select"
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                  >
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.enrolled}
                        {s.capacity ? ` of ${String(s.capacity)}` : ''})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">Roll no. (blank: next)</span>
                  <input
                    className="ep-input"
                    inputMode="numeric"
                    value={roll}
                    onChange={(e) => setRoll(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              </div>
              <div className="ep-form-actions">
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={pending || !sectionId}
                  onClick={() =>
                    start(async () => {
                      const r = await admitRegistration(id, {
                        classSectionId: sectionId,
                        ...(roll ? { rollNo: Number(roll) } : {}),
                      });
                      if (r.ok) {
                        const missed = Object.keys(r.data.skipped);
                        done(
                          `Admitted to section ${r.data.section}.${missed.length ? ` Not copied (check in the student profile): ${missed.join(', ')}.` : ''}`,
                        );
                      } else setMsg({ tone: 'danger', text: r.error });
                    })
                  }
                >
                  Admit to the student master
                </button>
              </div>
            </>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              The class has no section in the session&rsquo;s year yet: add sections under Academics
              first.
            </p>
          )}
        </section>
      ) : null}

      {canCancel && !['cancelled', 'withdrawn', 'draft'].includes(status) ? (
        askCancel ? (
          <section className="ep-rp__act" aria-label="Cancel">
            <p style={{ margin: 0 }}>
              {refund
                ? `The admission fee of ${rupees(refund.paid)} is refunded less ${String(refund.pct)}% (${rupees(refund.deduction)}): ${rupees(refund.amount)}, after the refund approvers agree.`
                : 'The registration fee is not refunded.'}
              {status === 'admitted' ? ' The pupil is withdrawn from the class-section.' : ''}
            </p>
            <label className="ep-field">
              <span className="ep-field__label">Reason</span>
              <input
                className="ep-input"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="ep-form-actions">
              <button
                type="button"
                className="ep-btn ep-btn--danger"
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await cancelRegistration(id, reason.trim());
                    if (r.ok)
                      done(
                        r.data.refund
                          ? `Cancelled; refund of ${rupees(r.data.refund.amount)} sent for approval.`
                          : 'Cancelled.',
                      );
                    else setMsg({ tone: 'danger', text: r.error });
                  })
                }
              >
                Cancel the{' '}
                {['fee_paid', 'admitted'].includes(status) ? 'admission' : 'registration'}
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--ghost"
                onClick={() => setAskCancel(false)}
              >
                Keep it
              </button>
            </div>
          </section>
        ) : (
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setAskCancel(true)}
            >
              Cancel{' '}
              {['fee_paid', 'admitted'].includes(status) ? 'the admission' : 'the registration'}…
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
    </div>
  );
}
