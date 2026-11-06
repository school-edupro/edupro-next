'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@edupro/ui';
import { savePaymentTerm } from '@/lib/purchase-actions';
import type { PaymentTerm } from '@/lib/purchase';

type Line = { pct: string; dueOn: 'advance' | 'delivery' | 'invoice'; days: string };
const DUE: Record<Line['dueOn'], string> = {
  advance: 'In advance (with the order)',
  delivery: 'After delivery',
  invoice: 'After the invoice',
};

/**
 * Payment terms in instalments (docs/design/83, part 1): each instalment a share, when it falls due
 * and after how many days; they add up to 100%. One term is the school's default; a vendor has its own.
 */
export function PaymentTerms({ terms, canManage }: { terms: PaymentTerm[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PaymentTerm | 'new' | null>(null);
  const [f, setF] = useState({ code: '', name: '', printText: '', isDefault: false, active: true });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = (t: PaymentTerm | 'new') => {
    setError(null);
    setEditing(t);
    if (t === 'new') {
      setF({ code: '', name: '', printText: '', isDefault: false, active: true });
      setLines([{ pct: '100', dueOn: 'invoice', days: '30' }]);
    } else {
      setF({
        code: t.code,
        name: t.name,
        printText: t.printText ?? '',
        isDefault: t.isDefault,
        active: t.status === 'active',
      });
      setLines(t.lines.map((l) => ({ pct: String(l.pct), dueOn: l.dueOn, days: String(l.days) })));
    }
  };
  const total = lines.reduce((s, l) => s + (Number(l.pct) || 0), 0);
  const save = () =>
    start(async () => {
      const r = await savePaymentTerm(editing === 'new' || !editing ? null : editing.id, {
        code: f.code,
        name: f.name,
        printText: f.printText || undefined,
        isDefault: f.isDefault,
        status: f.active ? 'active' : 'inactive',
        lines: lines.map((l) => ({
          pct: Number(l.pct),
          dueOn: l.dueOn,
          days: l.dueOn === 'advance' ? 0 : Number(l.days) || 0,
        })),
      });
      if (r.ok) {
        setEditing(null);
        router.refresh();
      } else setError(r.error);
    });
  return (
    <>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Payment terms">
        <table className="ep-table">
          <caption className="ep-sr-only">Payment terms</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Payment term</th>
              <th scope="col">Instalments</th>
              <th scope="col" className="is-numeric">
                Longest wait
              </th>
              <th scope="col" className="is-numeric">
                Vendors
              </th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>
                  <strong>{t.name}</strong>{' '}
                  {t.isDefault ? <Badge tone="info">Default</Badge> : null}{' '}
                  {t.status !== 'active' ? <Badge tone="neutral">Inactive</Badge> : null}
                </td>
                <td>{t.words}</td>
                <td className="is-numeric">
                  {t.longestDays} days
                  {t.longestDays > 45 ? (
                    <span className="ep-mr-col__desc">
                      over 45: warned for micro / small vendors
                    </span>
                  ) : null}
                </td>
                <td className="is-numeric">{t.vendors}</td>
                <td>
                  {canManage ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => open(t)}
                      aria-label={`Edit ${t.name}`}
                    >
                      Edit
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && editing === null ? (
        <p>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            onClick={() => open('new')}
          >
            Add payment term
          </button>
        </p>
      ) : null}
      {editing !== null ? (
        <section className="ep-card" aria-labelledby="pt-ed" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="pt-ed" className="ep-card__title">
            {editing === 'new' ? 'New payment term' : `Edit ${editing.name}`}
          </h2>
          <div className="ep-form-row" data-columns="3">
            <label className="ep-field" htmlFor="pt-code">
              <span className="ep-field__label" data-required="true">
                Code
              </span>
              <input
                id="pt-code"
                className="ep-input"
                value={f.code}
                maxLength={20}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="ep-field" htmlFor="pt-name">
              <span className="ep-field__label" data-required="true">
                Name
              </span>
              <input
                id="pt-name"
                className="ep-input"
                value={f.name}
                maxLength={120}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                placeholder="50% advance, 50% within 15 days of delivery"
              />
            </label>
            <label className="ep-field" htmlFor="pt-print">
              <span className="ep-field__label">Printed on the PO</span>
              <input
                id="pt-print"
                className="ep-input"
                value={f.printText}
                maxLength={500}
                onChange={(e) => setF({ ...f, printText: e.target.value })}
                placeholder="Empty: made from the instalments"
              />
            </label>
          </div>
          <div className="ep-purch-lines" style={{ marginTop: 'var(--sp-3)' }}>
            {lines.map((l, i) => (
              <fieldset key={i} className="ep-purch-line" style={{ border: 0, padding: 0 }}>
                <legend className="ep-sr-only">Instalment {i + 1}</legend>
                <label className="ep-field" htmlFor={`pt-l${String(i)}-pct`}>
                  <span className="ep-field__label">Instalment {i + 1}: %</span>
                  <input
                    id={`pt-l${String(i)}-pct`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.pct}
                    onChange={(e) =>
                      setLines((cur) =>
                        cur.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)),
                      )
                    }
                  />
                </label>
                <label className="ep-field" htmlFor={`pt-l${String(i)}-due`}>
                  <span className="ep-field__label">Due</span>
                  <select
                    id={`pt-l${String(i)}-due`}
                    className="ep-select"
                    value={l.dueOn}
                    onChange={(e) =>
                      setLines((cur) =>
                        cur.map((x, j) =>
                          j === i ? { ...x, dueOn: e.target.value as Line['dueOn'] } : x,
                        ),
                      )
                    }
                  >
                    {Object.entries(DUE).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {l.dueOn !== 'advance' ? (
                  <label className="ep-field" htmlFor={`pt-l${String(i)}-days`}>
                    <span className="ep-field__label">Days</span>
                    <input
                      id={`pt-l${String(i)}-days`}
                      className="ep-input"
                      inputMode="numeric"
                      value={l.days}
                      onChange={(e) =>
                        setLines((cur) =>
                          cur.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)),
                        )
                      }
                    />
                  </label>
                ) : (
                  <span />
                )}
                <div>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    disabled={lines.length === 1}
                    onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                    aria-label={`Remove instalment ${String(i + 1)}`}
                  >
                    Remove
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
          <p role="status" className={total === 100 ? 'ep-field__help' : 'ep-field__error'}>
            The instalments add up to {total}%{total === 100 ? '.' : ': they must add up to 100%.'}
          </p>
          <div
            style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}
          >
            {lines.length < 12 ? (
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() =>
                  setLines((cur) => [...cur, { pct: '', dueOn: 'delivery', days: '0' }])
                }
              >
                Add an instalment
              </button>
            ) : null}
            <label className="ep-check" htmlFor="pt-default">
              <input
                id="pt-default"
                className="ep-check__input"
                type="checkbox"
                checked={f.isDefault}
                onChange={(e) => setF({ ...f, isDefault: e.target.checked })}
              />
              <span className="ep-check__box" />
              The school’s default term
            </label>
            <label className="ep-check" htmlFor="pt-active">
              <input
                id="pt-active"
                className="ep-check__input"
                type="checkbox"
                checked={f.active}
                onChange={(e) => setF({ ...f, active: e.target.checked })}
              />
              <span className="ep-check__box" />
              Active
            </label>
          </div>
          {error ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="ep-form-actions">
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={save}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="ep-btn ep-btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
