'use client';
import { useActionState, useState } from 'react';
import type { BankAccount } from '@/lib/payroll-pay';
import { LAYOUT_FIELD_WORD } from '@/lib/payroll-pay';
import { tryLayout } from '@/lib/payroll-pay-actions';

const ROWS = 12;
const FORMATS: Record<string, string[]> = {
  date: ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DDMMYYYY'],
  amount: ['0.00', '0'],
};

/**
 * One of the school's bank accounts and the file its bank takes (docs/design/86, phase C step 1): the generic CSV,
 * the bank letter, or the bank's own layout — its columns in the bank's order, fixed values, a header row, the
 * separator — set from the bank's sample file and tried on two made-up payments before it is saved.
 */
export function BankAccountForm({
  account,
  save,
  idp,
}: {
  account: BankAccount | null;
  save: (fd: FormData) => Promise<void>;
  idp: string;
}) {
  const [format, setFormat] = useState(account?.fileFormat ?? 'GENERIC_CSV');
  const cols = account?.layout.columns ?? [];
  const [fields, setFields] = useState<string[]>(
    Array.from({ length: ROWS }, (_, i) => {
      const c = cols[i];
      return c ? (c.field ?? 'value') : '';
    }),
  );
  const [tried, tryIt, trying] = useActionState(tryLayout, null);
  return (
    <form action={save} className="ep-form-section__body">
      <div className="ep-form-row" data-columns="2">
        <label className="ep-field" htmlFor={`${idp}-code`}>
          <span className="ep-field__label">Bank (the IFSC’s first four letters)</span>
          <input
            id={`${idp}-code`}
            name="bankCode"
            className="ep-input"
            required
            pattern="[A-Za-z]{4}"
            maxLength={4}
            defaultValue={account?.bankCode ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`${idp}-name`}>
          <span className="ep-field__label">Bank name</span>
          <input
            id={`${idp}-name`}
            name="bankName"
            className="ep-input"
            required
            minLength={2}
            maxLength={80}
            defaultValue={account?.bankName ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`${idp}-branch`}>
          <span className="ep-field__label">Branch (for the letter)</span>
          <input
            id={`${idp}-branch`}
            name="branch"
            className="ep-input"
            maxLength={120}
            defaultValue={account?.branch ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`${idp}-acc`}>
          <span className="ep-field__label">The school’s account number</span>
          <input
            id={`${idp}-acc`}
            name="accountNo"
            className="ep-input"
            required
            pattern="[0-9A-Za-z]{6,20}"
            defaultValue={account?.accountNo ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`${idp}-fmt`}>
          <span className="ep-field__label">The file this bank takes</span>
          <select
            id={`${idp}-fmt`}
            name="fileFormat"
            className="ep-input"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="GENERIC_CSV">
              Generic CSV (name, account, IFSC, amount, narration)
            </option>
            <option value="CUSTOM_CSV">The bank’s own layout</option>
            <option value="BANK_LETTER">Bank letter only</option>
          </select>
        </label>
        {account ? (
          <label className="ep-check" htmlFor={`${idp}-act`}>
            <input
              id={`${idp}-act`}
              name="active"
              type="checkbox"
              defaultChecked={account.active}
            />{' '}
            In use
          </label>
        ) : null}
      </div>
      {format === 'CUSTOM_CSV' ? (
        <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ep-field__label">
            The bank’s columns, in its order (from its sample file)
          </legend>
          <div className="ep-form-row" data-columns="3">
            <label className="ep-check" htmlFor={`${idp}-hdr`}>
              <input
                id={`${idp}-hdr`}
                name="header"
                type="checkbox"
                defaultChecked={account?.layout.header ?? false}
              />{' '}
              A header row
            </label>
            <label className="ep-field" htmlFor={`${idp}-sep`}>
              <span className="ep-field__label">Separator</span>
              <select
                id={`${idp}-sep`}
                name="delimiter"
                className="ep-input"
                defaultValue={account?.layout.delimiter ?? ','}
              >
                <option value=",">Comma ,</option>
                <option value="|">Pipe |</option>
                <option value=";">Semicolon ;</option>
                <option value="^">Caret ^</option>
                <option value="TAB">Tab</option>
              </select>
            </label>
            <label className="ep-field" htmlFor={`${idp}-ext`}>
              <span className="ep-field__label">File type</span>
              <select
                id={`${idp}-ext`}
                name="extension"
                className="ep-input"
                defaultValue={account?.layout.extension ?? 'csv'}
              >
                <option value="csv">.csv</option>
                <option value="txt">.txt</option>
              </select>
            </label>
          </div>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="The bank’s columns">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col">What goes in it</th>
                  <th scope="col">Fixed value</th>
                  <th scope="col">Header</th>
                  <th scope="col">Format</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const c = cols[i];
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <select
                          name={`col${String(i)}.field`}
                          className="ep-input"
                          aria-label={`Column ${String(i + 1)}: what goes in it`}
                          value={f}
                          onChange={(e) =>
                            setFields((x) => x.map((v, k) => (k === i ? e.target.value : v)))
                          }
                        >
                          <option value="">— not used —</option>
                          {Object.entries(LAYOUT_FIELD_WORD).map(([k, w]) => (
                            <option key={k} value={k}>
                              {w}
                            </option>
                          ))}
                          <option value="value">A fixed value</option>
                        </select>
                      </td>
                      <td>
                        <input
                          name={`col${String(i)}.value`}
                          className="ep-input"
                          aria-label={`Column ${String(i + 1)}: fixed value`}
                          maxLength={60}
                          disabled={f !== 'value'}
                          defaultValue={c?.value ?? ''}
                        />
                      </td>
                      <td>
                        <input
                          name={`col${String(i)}.header`}
                          className="ep-input"
                          aria-label={`Column ${String(i + 1)}: header`}
                          maxLength={60}
                          disabled={!f}
                          defaultValue={c?.header ?? ''}
                        />
                      </td>
                      <td>
                        {FORMATS[f] ? (
                          <select
                            name={`col${String(i)}.format`}
                            className="ep-input"
                            aria-label={`Column ${String(i + 1)}: format`}
                            defaultValue={c?.format ?? FORMATS[f][0]}
                          >
                            {FORMATS[f].map((x) => (
                              <option key={x} value={x}>
                                {x === '0' ? 'Whole rupees' : x === '0.00' ? 'Rupees and paise' : x}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="ep-grid__toolbar">
            <button
              type="submit"
              formAction={tryIt}
              formNoValidate
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={trying}
            >
              {trying ? 'Trying…' : 'Try it on two made-up payments'}
            </button>
          </div>
          {tried?.text !== undefined ? (
            <pre
              className="ep-card"
              style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}
              aria-live="polite"
            >
              {tried.text}
            </pre>
          ) : null}
          {tried?.error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              {tried.error}
            </p>
          ) : null}
        </fieldset>
      ) : null}
      <div className="ep-grid__toolbar">
        <button type="submit" className="ep-btn ep-btn--primary">
          {account ? 'Save' : 'Add the account'}
        </button>
      </div>
    </form>
  );
}
