'use client';
import { useState, useTransition } from 'react';
import { revealPayrollValue } from '@/lib/payroll-actions';

/**
 * A masked PAN, Aadhaar or bank account with "Show" for a payroll checker: the full value comes back only with a
 * reason, and the API logs who looked and why (never the value). It is hidden again on the next page load.
 */
export function RevealValue({
  employeeId,
  field,
  label,
  masked,
  canReveal,
}: {
  employeeId: string;
  field: 'pan' | 'aadhaar' | 'bank_account_no';
  label: string;
  masked: string | null;
  canReveal: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `rv-${field}`;
  return (
    <div className="ep-field">
      <span className="ep-field__label">{label}</span>
      <span>
        {(value ?? masked) ? <code>{value ?? masked}</code> : 'Not on the employee record'}{' '}
        {canReveal && masked && !value && !asking ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => setAsking(true)}
          >
            Show
          </button>
        ) : null}
      </span>
      {asking && !value ? (
        <span className="ep-grid__toolbar">
          <label htmlFor={id} className="ep-sr-only">
            Why you need the full {label}
          </label>
          <input
            id={id}
            className="ep-input"
            placeholder="Why (at least 5 letters; logged)"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            disabled={pending || reason.trim().length < 5}
            onClick={() =>
              start(async () => {
                const r = await revealPayrollValue(employeeId, field, reason.trim());
                setError(r.error);
                if (r.value !== null) {
                  setValue(r.value);
                  setAsking(false);
                }
              })
            }
          >
            Show it
          </button>
        </span>
      ) : null}
      {error ? (
        <span className="ep-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
