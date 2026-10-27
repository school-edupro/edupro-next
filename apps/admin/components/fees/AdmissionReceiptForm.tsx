'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FileLinks } from '@/components/FileLinks';
import { counterCollect } from '@/lib/admission-counter-actions';
import type { CounterMode } from './PostReceiptForm';

/**
 * Post receipt for a registration's fee at the counter (docs/design/52), laid out like the pupils'
 * Post receipt: the school's payment modes, the fields each mode needs, the date and remarks. The
 * amount is the fee due, taken in full; it comes from the class and fee category, not the cashier.
 */
export function AdmissionReceiptForm({
  id,
  kind,
  head,
  amount,
  modes,
  banks,
  today,
  back,
}: {
  id: string;
  kind: 'registration' | 'admission';
  head: string;
  amount: number;
  modes: CounterMode[];
  banks: string[];
  today: string;
  /** where Cancel and Done go (the search it came from) */
  back: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(modes[0] ? optionValue(modes[0]) : 'cash');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; receiptId: string | null } | null>(null);
  const [pending, start] = useTransition();
  const mode = modes.find((m) => optionValue(m) === value);
  const modeKind = mode?.kind ?? 'cash';
  const cheque = modeKind === 'cheque' || modeKind === 'dd';
  const cash = modeKind === 'cash';
  const star = (on: boolean) => (on ? ' *' : '');
  const rupees = `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  if (done)
    return (
      <div className="ep-alert ep-alert--success ep-afc__done" role="status">
        <span>{done.text}</span>
        {done.receiptId ? (
          <FileLinks
            href={`/api/admission-counter/${id}/receipts/${done.receiptId}`}
            label="Receipt"
          />
        ) : null}
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={back}>
          Next registration
        </a>
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const s = (k: string) => String(fd.get(k) ?? '').trim();
        start(async () => {
          const r = await counterCollect(id, {
            kind,
            mode: modeKind,
            ...(mode && mode.label !== mode.kind ? { modeLabel: mode.label } : {}),
            receivedOn: s('receivedOn'),
            ...(s('reference') ? { reference: s('reference') } : {}),
            ...(s('instrumentNo') ? { instrumentNo: s('instrumentNo') } : {}),
            ...(s('instrumentDate') ? { instrumentDate: s('instrumentDate') } : {}),
            ...(s('bankName') ? { bankName: s('bankName') } : {}),
            ...(s('remarks') ? { remarks: s('remarks') } : {}),
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setError(null);
          setDone({
            text: [
              r.data.receiptNo ? `Receipt ${r.data.receiptNo} saved` : 'Saved',
              r.data.number ? `registration no. ${r.data.number}` : null,
              r.data.admissionNo ? `admission no. ${r.data.admissionNo}` : null,
            ]
              .filter(Boolean)
              .join('; '),
            receiptId: r.data.receiptId,
          });
          router.refresh();
        });
      }}
    >
      <div className="ep-afc__grid">
        <label className="ep-field">
          <span className="ep-field__label">Amount (₹) *</span>
          <input className="ep-input" value={amount.toFixed(2)} readOnly aria-readonly="true" />
          <span className="ep-field__help">
            Due on {head.toLowerCase()}: {rupees}. Taken in full; the amount follows the class and
            fee category.
          </span>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Payment mode *</span>
          <select
            className="ep-select"
            name="mode"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            {modes.map((m) => (
              <option key={m.code} value={optionValue(m)}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Received on *</span>
          <input
            className="ep-input"
            name="receivedOn"
            type="date"
            max={today}
            defaultValue={today}
            required
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Fee type *</span>
          <select className="ep-select" name="kind" value={kind} disabled>
            <option value={kind}>{head}</option>
          </select>
        </label>
        {cheque ? (
          <>
            <label className="ep-field">
              <span className="ep-field__label">
                {modeKind === 'dd' ? 'Draft no.' : 'Cheque no.'} *
              </span>
              <input
                className="ep-input"
                name="instrumentNo"
                required
                maxLength={40}
                inputMode="numeric"
                pattern="[0-9A-Za-z/-]{3,40}"
                title="3 to 40 letters or digits"
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">
                {modeKind === 'dd' ? 'Draft date' : 'Cheque date'}
                {star(Boolean(mode?.needInstrumentDate))}
              </span>
              <input
                className="ep-input"
                name="instrumentDate"
                type="date"
                required={mode?.needInstrumentDate}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Drawn on bank{star(Boolean(mode?.needBank))}</span>
              <input
                className="ep-input"
                name="bankName"
                list="afc-banks"
                maxLength={80}
                required={mode?.needBank}
                autoComplete="off"
              />
              <span className="ep-field__help">Pick from the list or type the bank’s name.</span>
              <datalist id="afc-banks">
                {banks.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
          </>
        ) : null}
        {!cash && !cheque ? (
          <label className="ep-field">
            <span className="ep-field__label">
              Reference / UTR no.{star(Boolean(mode?.needReference))}
            </span>
            <input
              className="ep-input"
              name="reference"
              maxLength={80}
              required={mode?.needReference}
            />
          </label>
        ) : null}
        <label className="ep-field">
          <span className="ep-field__label">Remarks</span>
          <input className="ep-input" name="remarks" maxLength={300} />
        </label>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <p className="ep-field__help">
        Fields marked * are compulsory. The receipt is in the admission series and shows in the Day
        book; View or download it after saving.
      </p>
      <div className="ep-afc__btns">
        <button type="submit" className="ep-btn" disabled={pending}>
          {pending ? 'Saving…' : 'Post receipt'}
        </button>
        <a className="ep-btn ep-btn--ghost" href={back}>
          Cancel
        </a>
      </div>
    </form>
  );
}

const optionValue = (m: CounterMode) => (m.code === m.kind ? m.code : `${m.kind}|${m.code}`);
