'use client';
import { useState } from 'react';

export interface CounterMode {
  code: string;
  kind: string;
  label: string;
  needReference: boolean;
  needInstrumentNo: boolean;
  needInstrumentDate: boolean;
  needBank: boolean;
}
export interface SchoolAccount {
  id: string;
  label: string;
  purpose: string;
  isDefault: boolean;
}

/**
 * The counter's receipt form. The fields follow the payment mode: a cheque asks for its number, date
 * and bank; UPI, card and bank transfer ask for the reference; everything but cash shows the school
 * account the money goes into. What the mode master marks mandatory is checked before saving.
 */
export function PostReceiptForm({
  action,
  studentId,
  modes,
  banks,
  accounts,
  payable,
  today,
  hasHostel,
  canSkipLateFee,
}: {
  action: (fd: FormData) => Promise<void>;
  studentId: string;
  modes: CounterMode[];
  banks: string[];
  accounts: SchoolAccount[];
  payable: string;
  today: string;
  hasHostel: boolean;
  canSkipLateFee: boolean;
}) {
  const [value, setValue] = useState(modes[0] ? optionValue(modes[0]) : 'cash');
  const [ledger, setLedger] = useState('school');
  const mode = modes.find((m) => optionValue(m) === value);
  const kind = mode?.kind ?? 'cash';
  const cheque = kind === 'cheque' || kind === 'dd';
  const cash = kind === 'cash';
  const forLedger = accounts.filter((a) => a.purpose === ledger || a.purpose === 'any');
  const star = (on: boolean) => (on ? ' *' : '');
  return (
    <form action={action}>
      <input type="hidden" name="studentId" value={studentId} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))',
          alignItems: 'start',
        }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Amount (₹) *</span>
          <input
            className="ep-input"
            name="amount"
            type="number"
            min={1}
            step="0.01"
            required
            defaultValue={Number(payable) > 0 ? payable : ''}
          />
          <span className="ep-field__help">Payable today: ₹{payable}</span>
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
        {hasHostel ? (
          <label className="ep-field">
            <span className="ep-field__label">Fee type *</span>
            <select
              className="ep-select"
              name="ledger"
              value={ledger}
              onChange={(e) => setLedger(e.target.value)}
            >
              <option value="school">Regular fee</option>
              <option value="hostel">Hostel fee</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="ledger" value="school" />
        )}
        {cheque ? (
          <>
            <label className="ep-field">
              <span className="ep-field__label">
                {kind === 'dd' ? 'Draft no.' : 'Cheque no.'} *
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
                {kind === 'dd' ? 'Draft date' : 'Cheque date'}
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
                list="cashier-banks"
                maxLength={80}
                required={mode?.needBank}
                autoComplete="off"
              />
              <span className="ep-field__help">Pick from the list or type the bank’s name.</span>
              <datalist id="cashier-banks">
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
        {!cash ? (
          forLedger.length > 1 ? (
            <label className="ep-field">
              <span className="ep-field__label">School account (money goes into) *</span>
              <select className="ep-select" name="bankAccountId" required defaultValue="">
                <option value="" disabled>
                  Choose the account
                </option>
                {forLedger.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : forLedger.length === 1 ? (
            <div className="ep-field">
              <span className="ep-field__label">School account (money goes into)</span>
              <input type="hidden" name="bankAccountId" value={forLedger[0]!.id} />
              <strong>{forLedger[0]!.label}</strong>
            </div>
          ) : (
            <div className="ep-field">
              <span className="ep-field__label">School account</span>
              <span className="ep-field__help">
                No school bank account is set up for this fee type (Fee setup → first tab).
              </span>
            </div>
          )
        ) : null}
        <label className="ep-field">
          <span className="ep-field__label">Late fee</span>
          <select
            className="ep-select"
            name="collectLateFee"
            defaultValue="yes"
            disabled={!canSkipLateFee}
          >
            <option value="yes">Collect the late fee due</option>
            <option value="no">Do not collect now</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Remarks</span>
          <input className="ep-input" name="remarks" maxLength={300} />
        </label>
      </div>
      <p className="ep-field__help">
        Fields marked * are compulsory. The money settles the oldest instalment first, late fee with
        it; anything extra stays as advance. The receipt opens for printing after saving.
      </p>
      <button type="submit" className="ep-btn">
        Post receipt and print
      </button>
    </form>
  );
}

const optionValue = (m: CounterMode) => (m.code === m.kind ? m.code : `${m.kind}|${m.code}`);
