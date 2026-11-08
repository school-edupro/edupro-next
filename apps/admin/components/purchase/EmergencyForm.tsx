'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { recordEmergency } from '@/lib/purchase-actions';
import { inr, type OrderFormLists } from '@/lib/purchase';

const FREE = 'free';
const BILL_TYPES = /^(application\/pdf|image\/(png|jpeg|webp))$/;

interface Line {
  itemId: string;
  description: string;
  uomId: string;
  quantity: string;
  rate: string;
  gstRate: string;
}
const blank = (): Line => ({
  itemId: '',
  description: '',
  uomId: '',
  quantity: '',
  rate: '',
  gstRate: '',
});

/**
 * Record an emergency purchase (docs/design/83, part 4; "As built — the emergency purchase form"): the
 * vendor, the department, when it was bought, why it could not wait, the vendor's bill, and what was
 * bought — each line an item from the list or one in words with its unit, the quantity, the rate before
 * GST and the GST % (the item's unless typed). Each line is checked by name before sending ("Line 2: the
 * rate is missing"), and nothing typed is lost when the API refuses it.
 */
export function EmergencyForm({ lists, today }: { lists: OrderFormLists; today: string }) {
  const router = useRouter();
  const items = new Map(lists.items.map((i) => [i.id, i]));
  const [head, setHead] = useState({
    vendorId: '',
    departmentId: lists.purchaseDepartmentId ?? '',
    poDate: today,
    reason: '',
    billRef: '',
  });
  const bill = useRef<File | null>(null);
  const [billName, setBillName] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const started = (l: Line) =>
    !!(l.itemId || l.description.trim() || l.quantity.trim() || l.rate.trim());
  const amountOf = (l: Line) => {
    const v = Number(l.quantity) * Number(l.rate);
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  };
  const total = lines.reduce((s, l) => s + amountOf(l), 0);

  /** what is missing, in words, or null when it can be sent */
  const problem = (): string | null => {
    if (!head.vendorId) return 'Pick the vendor.';
    if (head.reason.trim().length < 10) return 'Say why it could not wait (at least 10 letters).';
    const f = bill.current;
    if (!f) return 'Attach the vendor’s bill (PDF or photo).';
    if (!BILL_TYPES.test(f.type) || f.size > 5_242_880)
      return 'The bill must be a PDF or a photo (JPEG, PNG) up to 5 MB.';
    const used = lines.filter(started);
    if (!used.length) return 'Add what was bought: at least one line.';
    for (const [k, l] of lines.entries()) {
      if (!started(l)) continue;
      const n = `Line ${String(k + 1)}`;
      if (!l.itemId) return `${n}: pick the item, or “Not in the list” and describe it.`;
      if (l.itemId === FREE && l.description.trim().length < 2)
        return `${n}: describe what was bought.`;
      if (l.itemId === FREE && !l.uomId) return `${n}: pick the unit.`;
      const q = Number(l.quantity);
      if (!l.quantity.trim() || !Number.isFinite(q) || q <= 0)
        return `${n}: the quantity is missing (a number more than 0).`;
      const r = Number(l.rate);
      if (!l.rate.trim() || !Number.isFinite(r) || r < 0)
        return `${n}: the rate (₹, before GST) is missing.`;
      if (l.gstRate.trim()) {
        const g = Number(l.gstRate);
        if (!Number.isFinite(g) || g < 0 || g > 40) return `${n}: GST % from 0 to 40.`;
      }
    }
    return null;
  };

  const send = () => {
    const p = problem();
    setError(p);
    if (p) return;
    const fd = new FormData();
    fd.set('bill', bill.current!);
    fd.set(
      'body',
      JSON.stringify({
        vendorId: head.vendorId,
        ...(head.departmentId ? { departmentId: head.departmentId } : {}),
        reason: head.reason.trim(),
        ...(head.billRef.trim() ? { billRef: head.billRef.trim() } : {}),
        ...(head.poDate ? { poDate: head.poDate } : {}),
        lines: lines.filter(started).map((l) => ({
          ...(l.itemId !== FREE
            ? { itemId: l.itemId }
            : { description: l.description.trim(), uomId: l.uomId }),
          quantity: l.quantity,
          rate: l.rate,
          ...(l.gstRate.trim() ? { gstRate: l.gstRate } : {}),
        })),
      }),
    );
    start(async () => {
      const r = await recordEmergency(fd);
      if (r.ok) {
        router.push(
          `/purchase/orders/${r.id}?ok=1&detail=${encodeURIComponent(`${r.number} recorded: send it for ratification`)}`,
        );
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
      <FormSection title="The purchase">
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="em-v">
            <span className="ep-field__label" data-required="true">
              Vendor
            </span>
            <select
              id="em-v"
              className="ep-select"
              value={head.vendorId}
              onChange={(e) => setHead((h) => ({ ...h, vendorId: e.target.value }))}
            >
              <option value="">Pick the vendor</option>
              {lists.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.code})
                </option>
              ))}
            </select>
            <span className="ep-field__help">Only approved, active vendors.</span>
          </label>
          <label className="ep-field" htmlFor="em-d">
            <span className="ep-field__label">Department</span>
            <select
              id="em-d"
              className="ep-select"
              value={head.departmentId}
              onChange={(e) => setHead((h) => ({ ...h, departmentId: e.target.value }))}
            >
              <option value="">Not given</option>
              {lists.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="em-date">
            <span className="ep-field__label">Bought on</span>
            <input
              id="em-date"
              type="date"
              className="ep-input"
              max={today}
              value={head.poDate}
              onChange={(e) => setHead((h) => ({ ...h, poDate: e.target.value }))}
            />
          </label>
        </FormRow>
        <label className="ep-field" htmlFor="em-why">
          <span className="ep-field__label" data-required="true">
            Why it could not wait
          </span>
          <textarea
            id="em-why"
            className="ep-input"
            rows={2}
            maxLength={1000}
            value={head.reason}
            placeholder="e.g. a pipe burst in the junior block on Sunday night"
            onChange={(e) => setHead((h) => ({ ...h, reason: e.target.value }))}
          />
        </label>
        <FormRow columns={2}>
          <label className="ep-field" htmlFor="em-bill">
            <span className="ep-field__label" data-required="true">
              The vendor’s bill (PDF or photo)
            </span>
            <input
              id="em-bill"
              type="file"
              className="ep-input"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                bill.current = e.target.files?.[0] ?? null;
                setBillName(bill.current?.name ?? '');
              }}
            />
            <span className="ep-field__help">
              {billName ? `Attached: ${billName}` : 'Up to 5 MB.'}
            </span>
          </label>
          <label className="ep-field" htmlFor="em-ref">
            <span className="ep-field__label">Bill number</span>
            <input
              id="em-ref"
              className="ep-input"
              maxLength={60}
              value={head.billRef}
              onChange={(e) => setHead((h) => ({ ...h, billRef: e.target.value }))}
            />
          </label>
        </FormRow>
      </FormSection>

      <FormSection
        title="What was bought"
        description="One line per item: pick it from the list (or describe one not in the list, with its unit), the quantity and the rate paid before GST. The GST % is the item's unless typed."
      >
        <div className="ep-purch-lines">
          {lines.map((l, i) => {
            const n = String(i + 1);
            const it = items.get(l.itemId);
            const free = l.itemId === FREE;
            return (
              <fieldset key={i} className="ep-purch-line ep-purch-line--wide">
                <legend className="ep-sr-only">Line {n}</legend>
                <label className="ep-field ep-purch-line__item" htmlFor={`em-l${n}-i`}>
                  <span className="ep-field__label" data-required="true">
                    Item {n}
                  </span>
                  <select
                    id={`em-l${n}-i`}
                    className="ep-select"
                    value={l.itemId}
                    onChange={(e) => {
                      const x = items.get(e.target.value);
                      setLine(i, { itemId: e.target.value, ...(x ? { uomId: x.uomId } : {}) });
                    }}
                  >
                    <option value="">Pick the item</option>
                    <option value={FREE}>Not in the list: in words</option>
                    {lists.items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.code})
                      </option>
                    ))}
                  </select>
                </label>
                {free ? (
                  <>
                    <label className="ep-field" htmlFor={`em-l${n}-w`}>
                      <span className="ep-field__label" data-required="true">
                        In words
                      </span>
                      <input
                        id={`em-l${n}-w`}
                        className="ep-input"
                        maxLength={300}
                        value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`em-l${n}-u`}>
                      <span className="ep-field__label" data-required="true">
                        Unit
                      </span>
                      <select
                        id={`em-l${n}-u`}
                        className="ep-select"
                        value={l.uomId}
                        onChange={(e) => setLine(i, { uomId: e.target.value })}
                      >
                        <option value="">Pick the unit</option>
                        {lists.uoms.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.code})
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <label className="ep-field" htmlFor={`em-l${n}-q`}>
                  <span className="ep-field__label" data-required="true">
                    Quantity{it ? ` (${it.uom})` : ''}
                  </span>
                  <input
                    id={`em-l${n}-q`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`em-l${n}-r`}>
                  <span className="ep-field__label" data-required="true">
                    Rate (₹, before GST)
                  </span>
                  <input
                    id={`em-l${n}-r`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.rate}
                    onChange={(e) => setLine(i, { rate: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`em-l${n}-g`}>
                  <span className="ep-field__label">GST %</span>
                  <input
                    id={`em-l${n}-g`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.gstRate}
                    placeholder={it && it.gstRate !== null ? String(it.gstRate) : ''}
                    aria-describedby={`em-l${n}-gh`}
                    onChange={(e) => setLine(i, { gstRate: e.target.value })}
                  />
                  <span id={`em-l${n}-gh`} className="ep-field__help">
                    {it && it.gstRate !== null
                      ? `Empty: the item’s ${String(it.gstRate)}%`
                      : 'Empty: none'}
                  </span>
                </label>
                <div className="ep-field">
                  <span className="ep-field__label">Before GST</span>
                  <output className="ep-purch-amount" htmlFor={`em-l${n}-q em-l${n}-r`}>
                    {inr(amountOf(l))}
                  </output>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                    >
                      Remove line {n}
                    </button>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            marginTop: 'var(--sp-3)',
          }}
        >
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={lines.length >= 50}
            onClick={() => setLines((cur) => [...cur, blank()])}
          >
            Add a line
          </button>
          <p className="ep-purch-total">
            Before GST: <strong>{inr(total)}</strong>
          </p>
        </div>
      </FormSection>

      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <FormActions>
        <a className="ep-btn ep-btn--ghost" href="/purchase/orders">
          Cancel
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Recording…' : 'Record it'}
        </button>
      </FormActions>
    </form>
  );
}
