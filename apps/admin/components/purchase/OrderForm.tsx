'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { saveOrder } from '@/lib/purchase-actions';
import { CHARGE_KIND, inr, type OrderDetail } from '@/lib/purchase';

interface Line {
  id: string;
  description: string;
  hsnCode: string;
  quantity: string;
  maxQuantity: number | null;
  uom: string;
  rate: string;
  discountPct: string;
  gstRate: string;
  contractRate: number | null;
  rateChangeReason: string;
  make: string;
  model: string;
}
interface Charge {
  kind: keyof typeof CHARGE_KIND;
  label: string;
  amount: string;
  gstRate: string;
}

/**
 * A draft Purchase Order changed (docs/design/83, part 4): the quotation reference, dates, delivery,
 * payment term, validity and terms; each line's words, HSN / SAC, quantity (up to what the requisition
 * still needs), rate, discount and GST rate (a rate-contract line's rate changed only with a reason);
 * other charges with their GST. The API works out the GST by the vendor's state and the totals.
 */
export function OrderForm({
  po,
  hsn,
}: {
  po: OrderDetail;
  /** the HSN / SAC master, offered as the line's code is typed */
  hsn: Array<{ code: string; description: string; gstRate: number }>;
}) {
  const router = useRouter();
  const [head, setHead] = useState({
    quoteRef: po.quoteRef ?? '',
    poDate: po.poDate,
    deliveryDate: po.deliveryDate ?? '',
    deliveryAddress: po.deliveryAddress ?? '',
    paymentTermId: po.paymentTermId ?? '',
    validityDays: String(po.validityDays),
    terms: po.terms ?? '',
    freightTerms: po.freightTerms ?? '',
    vendorNote: po.vendorNote ?? '',
  });
  const [lines, setLines] = useState<Line[]>(
    po.lineItems.map((l) => ({
      id: l.id,
      description: l.description,
      hsnCode: l.hsnCode ?? '',
      quantity: String(l.quantity),
      maxQuantity: l.maxQuantity,
      uom: l.uom,
      rate: String(l.rate),
      discountPct: String(l.discountPct),
      gstRate: String(l.gstRate),
      contractRate: l.contractRate,
      rateChangeReason: l.rateChangeReason ?? '',
      make: l.make ?? '',
      model: l.model ?? '',
    })),
  );
  const [charges, setCharges] = useState<Charge[]>(
    po.charges.map((x) => ({
      kind: x.kind,
      label: x.ownLabel ?? '',
      amount: String(x.amount),
      gstRate: String(x.gstRate),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setCharge = (i: number, patch: Partial<Charge>) =>
    setCharges((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const taxable = (l: Line) => {
    const v = Number(l.quantity) * Number(l.rate) * (1 - Number(l.discountPct || 0) / 100);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  };
  const rateChanged = (l: Line) =>
    l.contractRate !== null && Math.abs(Number(l.rate) - l.contractRate) > 0.004;

  const send = () => {
    setError(null);
    const body = {
      quoteRef: head.quoteRef || undefined,
      poDate: head.poDate || undefined,
      deliveryDate: head.deliveryDate || null,
      deliveryAddress: head.deliveryAddress || undefined,
      paymentTermId: head.paymentTermId || null,
      validityDays: head.validityDays,
      freightTerms: head.freightTerms || undefined,
      vendorNote: head.vendorNote || undefined,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        hsnCode: l.hsnCode || null,
        quantity: l.quantity,
        rate: l.rate,
        discountPct: l.discountPct || 0,
        gstRate: l.gstRate || 0,
        ...(rateChanged(l) && l.rateChangeReason ? { rateChangeReason: l.rateChangeReason } : {}),
        ...(l.make.trim() ? { make: l.make.trim() } : {}),
        ...(l.model.trim() ? { model: l.model.trim() } : {}),
      })),
      charges: charges
        .filter((x) => x.amount !== '')
        .map((x) => ({
          kind: x.kind,
          label: x.label || undefined,
          amount: x.amount,
          gstRate: x.gstRate || 0,
        })),
    };
    start(async () => {
      const r = await saveOrder(po.id, body);
      if (r.ok) {
        router.push(`/purchase/orders/${po.id}?ok=1&detail=${encodeURIComponent('PO saved')}`);
        return;
      }
      setError(r.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      noValidate
    >
      <datalist id="of-hsn-list">
        {hsn.map((h) => (
          <option key={h.code} value={h.code}>
            {`${h.description} (${String(h.gstRate)}%)`}
          </option>
        ))}
      </datalist>
      <FormSection title="The order">
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="of-ref">
            <span className="ep-field__label">Vendor’s quotation no. (optional)</span>
            <input
              id="of-ref"
              className="ep-input"
              maxLength={60}
              value={head.quoteRef}
              placeholder="e.g. Q-1123 of 02-11-2026"
              aria-describedby="of-ref-help"
              onChange={(e) => setHead((h) => ({ ...h, quoteRef: e.target.value }))}
            />
            <span id="of-ref-help" className="ep-field__help">
              The vendor’s own quotation number this PO accepts; printed on the PO as “Your
              quotation”.
            </span>
          </label>
          <label className="ep-field" htmlFor="of-date">
            <span className="ep-field__label">PO date</span>
            <input
              id="of-date"
              type="date"
              className="ep-input"
              value={head.poDate}
              onChange={(e) => setHead((h) => ({ ...h, poDate: e.target.value }))}
            />
          </label>
          <label className="ep-field" htmlFor="of-valid">
            <span className="ep-field__label" data-required="true">
              Valid for (days)
            </span>
            <input
              id="of-valid"
              className="ep-input"
              inputMode="numeric"
              value={head.validityDays}
              onChange={(e) => setHead((h) => ({ ...h, validityDays: e.target.value }))}
            />
          </label>
        </FormRow>
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="of-by">
            <span className="ep-field__label">Deliver by</span>
            <input
              id="of-by"
              type="date"
              className="ep-input"
              value={head.deliveryDate}
              onChange={(e) => setHead((h) => ({ ...h, deliveryDate: e.target.value }))}
            />
          </label>
          <label className="ep-field" htmlFor="of-addr">
            <span className="ep-field__label">Deliver to</span>
            <input
              id="of-addr"
              className="ep-input"
              maxLength={500}
              value={head.deliveryAddress}
              onChange={(e) => setHead((h) => ({ ...h, deliveryAddress: e.target.value }))}
            />
          </label>
          <label className="ep-field" htmlFor="of-term">
            <span className="ep-field__label">Payment term</span>
            <select
              id="of-term"
              className="ep-select"
              value={head.paymentTermId}
              onChange={(e) => setHead((h) => ({ ...h, paymentTermId: e.target.value }))}
            >
              <option value="">None</option>
              {po.paymentTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {po.msmeWarning ? (
              <span className="ep-field__help">MSME vendor: pay within 45 days.</span>
            ) : null}
          </label>
        </FormRow>
        <FormRow columns={2}>
          <label className="ep-field" htmlFor="of-freight">
            <span className="ep-field__label">Freight terms</span>
            <input
              id="of-freight"
              className="ep-input"
              maxLength={300}
              value={head.freightTerms}
              placeholder="e.g. Free delivery at the school; or freight extra at actuals"
              onChange={(e) => setHead((h) => ({ ...h, freightTerms: e.target.value }))}
            />
          </label>
          <label className="ep-field" htmlFor="of-note">
            <span className="ep-field__label">Note to the vendor</span>
            <input
              id="of-note"
              className="ep-input"
              maxLength={1000}
              value={head.vendorNote}
              placeholder="Printed on the PO"
              onChange={(e) => setHead((h) => ({ ...h, vendorNote: e.target.value }))}
            />
          </label>
        </FormRow>
        <div className="ep-field">
          <span className="ep-field__label">General instructions</span>
          <p
            className="ep-field__help"
            style={{ whiteSpace: 'pre-line', margin: 0, color: 'inherit' }}
          >
            {head.terms || 'None set yet.'}
          </p>
          <span className="ep-field__help">
            From <a href="/purchase/settings">Purchase settings</a> (Terms and conditions), the same
            on every PO and fixed when this one is approved. Anything for this PO only goes in Note
            to the vendor.
          </span>
        </div>
      </FormSection>

      <FormSection
        title="Lines"
        description="Rates before GST. The GST is worked out on save: CGST + SGST for a vendor in the school’s state, IGST for one outside it, none for an unregistered or composition vendor."
      >
        <div className="ep-purch-lines">
          {lines.map((l, i) => {
            const n = String(i + 1);
            return (
              <fieldset key={l.id} className="ep-purch-line ep-purch-line--wide">
                <legend className="ep-sr-only">Line {n}</legend>
                <label className="ep-field ep-purch-line__item" htmlFor={`of-l${n}-d`}>
                  <span className="ep-field__label" data-required="true">
                    Line {n}
                  </span>
                  <input
                    id={`of-l${n}-d`}
                    className="ep-input"
                    maxLength={300}
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-h`}>
                  <span className="ep-field__label">HSN / SAC</span>
                  <input
                    id={`of-l${n}-h`}
                    className="ep-input"
                    inputMode="numeric"
                    maxLength={8}
                    list="of-hsn-list"
                    value={l.hsnCode}
                    aria-describedby={`of-l${n}-h-help`}
                    onChange={(e) => setLine(i, { hsnCode: e.target.value })}
                  />
                  <span id={`of-l${n}-h-help`} className="ep-field__help">
                    {l.hsnCode
                      ? (hsn.find((h) => h.code === l.hsnCode)?.description ??
                        'Not in the HSN list')
                      : 'Not set on the item: type or pick the code (set it on the item in Masters → Items for next time)'}
                  </span>
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-make`}>
                  <span className="ep-field__label">Make</span>
                  <input
                    id={`of-l${n}-make`}
                    className="ep-input"
                    maxLength={80}
                    value={l.make}
                    onChange={(e) => setLine(i, { make: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-model`}>
                  <span className="ep-field__label">Model</span>
                  <input
                    id={`of-l${n}-model`}
                    className="ep-input"
                    maxLength={80}
                    value={l.model}
                    onChange={(e) => setLine(i, { model: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-q`}>
                  <span className="ep-field__label" data-required="true">
                    Quantity ({l.uom})
                  </span>
                  <input
                    id={`of-l${n}-q`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                  {l.maxQuantity !== null ? (
                    <span className="ep-field__help">Up to {l.maxQuantity}</span>
                  ) : null}
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-r`}>
                  <span className="ep-field__label" data-required="true">
                    Rate (₹)
                  </span>
                  <input
                    id={`of-l${n}-r`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.rate}
                    onChange={(e) => setLine(i, { rate: e.target.value })}
                  />
                  {l.contractRate !== null ? (
                    <span className="ep-field__help">Contract {inr(l.contractRate)}</span>
                  ) : null}
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-x`}>
                  <span className="ep-field__label">Discount %</span>
                  <input
                    id={`of-l${n}-x`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.discountPct}
                    onChange={(e) => setLine(i, { discountPct: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-l${n}-g`}>
                  <span className="ep-field__label">GST %</span>
                  <input
                    id={`of-l${n}-g`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.gstRate}
                    onChange={(e) => setLine(i, { gstRate: e.target.value })}
                  />
                </label>
                {rateChanged(l) ? (
                  <label className="ep-field" htmlFor={`of-l${n}-why`}>
                    <span className="ep-field__label" data-required="true">
                      Why not the contract rate
                    </span>
                    <input
                      id={`of-l${n}-why`}
                      className="ep-input"
                      maxLength={300}
                      value={l.rateChangeReason}
                      onChange={(e) => setLine(i, { rateChangeReason: e.target.value })}
                    />
                  </label>
                ) : null}
                <div className="ep-field">
                  <span className="ep-field__label">Before GST</span>
                  <output className="ep-purch-amount" htmlFor={`of-l${n}-q of-l${n}-r of-l${n}-x`}>
                    {inr(taxable(l))}
                  </output>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      title="The line leaves this PO (nothing is cancelled): it waits on Purchase → To order, to be ordered later or from another vendor"
                      onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                    >
                      Remove line {n} from this PO (it waits on To order)
                    </button>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
        </div>
      </FormSection>

      <FormSection
        title="Other charges"
        description="Freight, installation, packing: each with its GST."
      >
        <div className="ep-purch-lines">
          {charges.map((x, i) => {
            const n = String(i + 1);
            return (
              <fieldset key={i} className="ep-purch-line">
                <legend className="ep-sr-only">Charge {n}</legend>
                <label className="ep-field" htmlFor={`of-c${n}-k`}>
                  <span className="ep-field__label">Charge {n}</span>
                  <select
                    id={`of-c${n}-k`}
                    className="ep-select"
                    value={x.kind}
                    onChange={(e) =>
                      setCharge(i, { kind: e.target.value as keyof typeof CHARGE_KIND })
                    }
                  >
                    {(Object.keys(CHARGE_KIND) as Array<keyof typeof CHARGE_KIND>).map((k) => (
                      <option key={k} value={k}>
                        {CHARGE_KIND[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor={`of-c${n}-l`}>
                  <span className="ep-field__label">Words on the PO</span>
                  <input
                    id={`of-c${n}-l`}
                    className="ep-input"
                    maxLength={80}
                    value={x.label}
                    onChange={(e) => setCharge(i, { label: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-c${n}-a`}>
                  <span className="ep-field__label">Amount (₹)</span>
                  <input
                    id={`of-c${n}-a`}
                    className="ep-input"
                    inputMode="decimal"
                    value={x.amount}
                    onChange={(e) => setCharge(i, { amount: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`of-c${n}-g`}>
                  <span className="ep-field__label">GST %</span>
                  <input
                    id={`of-c${n}-g`}
                    className="ep-input"
                    inputMode="decimal"
                    value={x.gstRate}
                    onChange={(e) => setCharge(i, { gstRate: e.target.value })}
                  />
                </label>
                <div className="ep-field">
                  <span className="ep-field__label">
                    <span className="ep-sr-only">Charge {n}</span>
                  </span>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => setCharges((cur) => cur.filter((_, j) => j !== i))}
                  >
                    Remove charge {n}
                  </button>
                </div>
              </fieldset>
            );
          })}
          {charges.length < 10 ? (
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() =>
                  setCharges((cur) => [
                    ...cur,
                    { kind: 'freight', label: '', amount: '', gstRate: '18' },
                  ])
                }
              >
                Add a charge
              </button>
            </div>
          ) : null}
        </div>
      </FormSection>

      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <FormActions>
        <a className="ep-btn ep-btn--ghost" href={`/purchase/orders/${po.id}`}>
          Cancel
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </FormActions>
    </form>
  );
}
