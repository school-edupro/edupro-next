'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { counterCollect } from '@/lib/admission-counter-actions';
import { rupees } from '@/lib/admission-desk';

/**
 * Take the fee due at the counter (docs/design/52, part 3): the amount comes from the class and fee
 * category and cannot be changed here; the receipt follows at once.
 */
export function AdmissionCounterCollect({
  id,
  kind,
  head,
  amount,
  candidate,
}: {
  id: string;
  kind: 'registration' | 'admission';
  head: string;
  amount: number;
  candidate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const instrument = mode === 'cheque' || mode === 'dd';
  const panel = `ac-collect-${id}`;

  if (receipt)
    return (
      <div className="ep-afc__done" role="status">
        <span>{msg?.text}</span>
        <FileLinks href={`/api/admission-counter/${id}/receipts/${receipt}`} label="Receipt" />
      </div>
    );
  return (
    <div className="ep-afc__collect">
      <button
        type="button"
        className="ep-btn ep-btn--primary ep-btn--sm"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
      >
        Collect {rupees(amount)}
      </button>
      {open ? (
        <div id={panel} className="ep-afc__form">
          <p className="ep-field__help" style={{ margin: 0 }}>
            {head} for {candidate}: <strong>{rupees(amount)}</strong>, in full.
          </p>
          <label className="ep-field">
            <span className="ep-field__label">Paid by</span>
            <select className="ep-select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="dd">Demand draft</option>
              <option value="bank">Bank transfer</option>
            </select>
          </label>
          {mode !== 'cash' ? (
            <label className="ep-field">
              <span className="ep-field__label">
                {instrument
                  ? `${mode === 'dd' ? 'DD' : 'Cheque'} no. (required)`
                  : 'Reference / UTR'}
              </span>
              <input
                className="ep-input"
                maxLength={instrument ? 40 : 80}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          ) : null}
          {instrument ? (
            <label className="ep-field">
              <span className="ep-field__label">Bank</span>
              <input
                className="ep-input"
                maxLength={80}
                value={bank}
                onChange={(e) => setBank(e.target.value)}
              />
            </label>
          ) : null}
          <div className="ep-afc__btns">
            <button
              type="button"
              className="ep-btn ep-btn--primary ep-btn--sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (instrument && !reference.trim()) {
                    setMsg({ tone: 'danger', text: 'Write the cheque or DD number.' });
                    return;
                  }
                  const r = await counterCollect(id, {
                    kind,
                    mode,
                    ...(reference.trim()
                      ? instrument
                        ? { instrumentNo: reference.trim() }
                        : { reference: reference.trim() }
                      : {}),
                    ...(instrument && bank.trim() ? { bankName: bank.trim() } : {}),
                  });
                  if (!r.ok) {
                    setMsg({ tone: 'danger', text: r.error });
                    return;
                  }
                  setMsg({
                    tone: 'success',
                    text: [
                      r.data.receiptNo ? `Receipt ${r.data.receiptNo}` : 'Taken',
                      r.data.number ? `registration no. ${r.data.number}` : null,
                      r.data.admissionNo ? `admission no. ${r.data.admissionNo}` : null,
                    ]
                      .filter(Boolean)
                      .join('; '),
                  });
                  setReceipt(r.data.receiptId);
                  router.refresh();
                })
              }
            >
              {pending ? 'Saving…' : `Take ${rupees(amount)}`}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          {msg?.tone === 'danger' ? (
            <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
              {msg.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
