'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { saveIndent } from '@/lib/purchase-actions';
import { inr, RATE_SOURCE, type IndentDetail, type IndentFormLists } from '@/lib/purchase';

const FREE = 'free';

interface Line {
  itemId: string;
  freeText: string;
  quantity: string;
  uomId: string;
  estRate: string;
  /** the rate was typed (not the contract's or the last purchase's) */
  typed: boolean;
  note: string;
  /** why it is bought though the stores have enough */
  stockReason: string;
}
const blank = (): Line => ({
  itemId: '',
  freeText: '',
  quantity: '',
  uomId: '',
  estRate: '',
  typed: false,
  note: '',
  stockReason: '',
});
const qtyWords = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Raise or change a Purchase Indent (docs/design/83, part 2): the department (the raiser's own unless
 * they may raise for any), whom it is for, the purpose, when it is needed, and the lines — a catalogue
 * item or one described in words. Under each item, what the main store and the department's stores
 * hold free; when they hold enough for the quantity, the raiser says why it is bought anyway. Rates
 * and amounts show only to those who see them (the purchase office): a raiser sees none, and the
 * estimate is worked out from the rate contract, else the last purchase. Saved as a draft, or saved
 * and sent to the department's approvers. What was typed stays on a refusal.
 */
export function IndentForm({
  indent,
  lists,
}: {
  indent: IndentDetail | null;
  lists: IndentFormLists;
}) {
  const router = useRouter();
  const items = useMemo(() => new Map(lists.items.map((i) => [i.id, i])), [lists.items]);
  const byCategory = useMemo(() => {
    const m = new Map<string, IndentFormLists['items']>();
    for (const i of lists.items) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [lists.items]);
  const [head, setHead] = useState({
    departmentId:
      indent?.departmentId ?? (lists.departments.length === 1 ? lists.departments[0]!.id : ''),
    onBehalfEmployeeId: indent?.onBehalfEmployeeId ?? '',
    purpose: indent?.purpose ?? '',
    requiredBy: indent?.requiredBy ?? '',
    priority: indent?.priority ?? 'normal',
  });
  const [lines, setLines] = useState<Line[]>(
    indent?.lineItems.length
      ? indent.lineItems.map((l) => ({
          itemId: l.itemId ?? FREE,
          freeText: l.itemId ? '' : l.item,
          quantity: String(l.quantity),
          uomId: l.uomId,
          estRate: l.estRate === null ? '' : String(l.estRate),
          typed: l.rateSource === 'typed',
          note: l.note ?? '',
          stockReason: l.stockReason ?? '',
        }))
      : [blank()],
  );
  const [error, setError] = useState<string | null>(null);
  // a send was tried: the reasons still missing show their error
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();
  const showRates = lists.showRates;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const it = items.get(itemId);
    const rate = it ? (it.contractRate ?? it.lastRate) : null;
    setLine(i, {
      itemId,
      uomId: it ? it.uomId : '',
      estRate: rate === null ? '' : String(rate),
      typed: !it || rate === null,
      freeText: itemId === FREE ? lines[i]!.freeText : '',
    });
  };
  const amountOf = (l: Line) => {
    const q = Number(l.quantity);
    const r = Number(l.estRate);
    return Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : 0;
  };
  const total = lines.reduce((s, l) => s + amountOf(l), 0);
  /**
   * What the main store and the chosen department's stores hold free of the line's item, and whether
   * that covers the quantity (in the store unit).
   */
  const stockOf = (l: Line) => {
    const it = items.get(l.itemId);
    if (!it || !it.stockTracked) return null;
    const stores = it.stock.filter(
      (s) => s.main || (head.departmentId !== '' && s.departmentId === head.departmentId),
    );
    const free = Math.round(stores.reduce((t, s) => t + s.free, 0) * 1000) / 1000;
    const q = Number(l.quantity);
    const need = Number.isFinite(q) && q > 0 ? q * it.perUnit : 0;
    return { stores, free, unit: it.stockUom, need, covers: need > 0 && free >= need };
  };
  const sourceOf = (l: Line) => {
    const it = items.get(l.itemId);
    if (!it || l.typed) return RATE_SOURCE.typed;
    if (it.contractRate !== null)
      return `${RATE_SOURCE.contract}${it.contractVendor ? `: ${it.contractVendor}` : ''}`;
    return it.lastRate !== null ? RATE_SOURCE.last : RATE_SOURCE.typed;
  };

  const send = (submit: boolean) => {
    setError(null);
    if (submit && lines.some((l) => stockOf(l)?.covers && l.stockReason.trim().length < 3)) {
      setTried(true);
      setError(
        'The store already has enough of an item: say why it is bought (marked below), or lower the quantity.',
      );
      return;
    }
    const body = {
      ...(head.departmentId ? { departmentId: head.departmentId } : {}),
      ...(head.onBehalfEmployeeId ? { onBehalfEmployeeId: head.onBehalfEmployeeId } : {}),
      purpose: head.purpose,
      ...(head.requiredBy ? { requiredBy: head.requiredBy } : {}),
      priority: head.priority,
      lines: lines
        .filter((l) => l.itemId || l.freeText.trim() || l.quantity)
        .map((l) =>
          l.itemId && l.itemId !== FREE
            ? {
                itemId: l.itemId,
                quantity: l.quantity,
                ...(showRates && l.typed && l.estRate !== '' ? { estRate: l.estRate } : {}),
                ...(l.note.trim() ? { note: l.note } : {}),
                ...(stockOf(l)?.covers && l.stockReason.trim()
                  ? { stockReason: l.stockReason.trim() }
                  : {}),
              }
            : {
                freeText: l.freeText,
                quantity: l.quantity,
                ...(l.uomId ? { uomId: l.uomId } : {}),
                ...(showRates && l.estRate !== '' ? { estRate: l.estRate } : {}),
                ...(l.note.trim() ? { note: l.note } : {}),
              },
        ),
    };
    start(async () => {
      const r = await saveIndent(indent?.id ?? null, body, submit);
      if (r.ok) {
        const said = submit
          ? `${r.number ?? 'The indent'} sent to the department’s approvers`
          : 'Saved as a draft';
        router.push(`/purchase/indents/${r.id}?ok=1&detail=${encodeURIComponent(said)}`);
        return;
      }
      if (r.id) {
        router.push(
          `/purchase/indents/${r.id}?error=not-sent&detail=${encodeURIComponent(r.error)}`,
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
        send(true);
      }}
      noValidate
    >
      <FormSection title="The indent">
        <FormRow columns={3}>
          <label className="ep-field" htmlFor="if-dept">
            <span className="ep-field__label" data-required="true">
              Department
            </span>
            <select
              id="if-dept"
              className="ep-select"
              value={head.departmentId}
              onChange={(e) => setHead((h) => ({ ...h, departmentId: e.target.value }))}
              disabled={!lists.anyDepartment && lists.departments.length <= 1}
            >
              {lists.departments.length !== 1 ? (
                <option value="">Pick the department</option>
              ) : null}
              {lists.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {!lists.departments.length ? (
              <span className="ep-field__help">
                Your employee record has no department: ask the office to set it.
              </span>
            ) : null}
          </label>
          <label className="ep-field" htmlFor="if-for">
            <span className="ep-field__label">For a colleague (optional)</span>
            <select
              id="if-for"
              className="ep-select"
              value={head.onBehalfEmployeeId}
              onChange={(e) => setHead((h) => ({ ...h, onBehalfEmployeeId: e.target.value }))}
            >
              <option value="">Myself</option>
              {lists.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="if-by">
            <span className="ep-field__label">Needed by</span>
            <input
              id="if-by"
              type="date"
              className="ep-input"
              min={today}
              value={head.requiredBy}
              onChange={(e) => setHead((h) => ({ ...h, requiredBy: e.target.value }))}
            />
          </label>
        </FormRow>
        <FormRow columns={2}>
          <label className="ep-field" htmlFor="if-purpose">
            <span className="ep-field__label" data-required="true">
              Purpose
            </span>
            <textarea
              id="if-purpose"
              className="ep-input"
              rows={2}
              maxLength={500}
              value={head.purpose}
              placeholder="What it is for, e.g. Class IX chemistry practicals, term 2"
              onChange={(e) => setHead((h) => ({ ...h, purpose: e.target.value }))}
            />
          </label>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Priority</legend>
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              {(
                [
                  ['normal', 'Normal'],
                  ['urgent', 'Urgent (shown first to approvers)'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="ep-check" htmlFor={`if-pr-${v}`}>
                  <input
                    id={`if-pr-${v}`}
                    className="ep-check__input"
                    type="radio"
                    name="if-priority"
                    checked={head.priority === v}
                    onChange={() => setHead((h) => ({ ...h, priority: v }))}
                  />
                  <span className="ep-check__box" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </FormRow>
      </FormSection>

      <FormSection
        title="Items"
        description={
          showRates
            ? 'Pick from the item list (its rate comes from the rate contract, else the last purchase; you may type your own estimate); what the stores hold free shows under it. Not in the list? Pick “Not in the list” and describe it: the purchase office matches it on the PR.'
            : 'Pick from the item list; what the stores hold free shows under it. Not in the list? Pick “Not in the list” and describe it: the purchase office matches it on the PR and prices the indent.'
        }
      >
        <div className="ep-purch-lines">
          {lines.map((l, i) => {
            const it = items.get(l.itemId);
            const free = l.itemId === FREE;
            const n = String(i + 1);
            const stock = stockOf(l);
            const whyMissing = tried && !!stock?.covers && l.stockReason.trim().length < 3;
            return (
              <fieldset key={i} className="ep-purch-line ep-purch-line--wide">
                <legend className="ep-sr-only">Line {n}</legend>
                <label className="ep-field ep-purch-line__item" htmlFor={`if-l${n}-item`}>
                  <span className="ep-field__label" data-required="true">
                    Item {n}
                  </span>
                  <select
                    id={`if-l${n}-item`}
                    className="ep-select"
                    value={l.itemId}
                    aria-describedby={stock ? `if-l${n}-stock` : undefined}
                    onChange={(e) => pickItem(i, e.target.value)}
                  >
                    <option value="">Pick the item</option>
                    {byCategory.map(([cat, list]) => (
                      <optgroup key={cat} label={cat}>
                        {list.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.code})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value={FREE}>Not in the list: describe it</option>
                  </select>
                  {stock ? (
                    <span id={`if-l${n}-stock`} className="ep-field__help">
                      {stock.stores.length
                        ? `In the stores: ${qtyWords(stock.free)} ${stock.unit} free (${stock.stores
                            .map((s) => `${s.store} ${qtyWords(s.free)}`)
                            .join(' · ')})`
                        : 'In the stores: none free'}
                    </span>
                  ) : null}
                </label>
                {free ? (
                  <label className="ep-field" htmlFor={`if-l${n}-text`}>
                    <span className="ep-field__label" data-required="true">
                      Describe it
                    </span>
                    <input
                      id={`if-l${n}-text`}
                      className="ep-input"
                      maxLength={300}
                      value={l.freeText}
                      onChange={(e) => setLine(i, { freeText: e.target.value })}
                    />
                  </label>
                ) : null}
                <label className="ep-field" htmlFor={`if-l${n}-qty`}>
                  <span className="ep-field__label" data-required="true">
                    Quantity{it ? ` (${it.uom})` : ''}
                  </span>
                  <input
                    id={`if-l${n}-qty`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                  {it && !it.decimals ? (
                    <span className="ep-field__help">A whole number</span>
                  ) : null}
                </label>
                {free ? (
                  <label className="ep-field" htmlFor={`if-l${n}-uom`}>
                    <span className="ep-field__label" data-required="true">
                      Unit
                    </span>
                    <select
                      id={`if-l${n}-uom`}
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
                ) : null}
                {showRates ? (
                  <label className="ep-field" htmlFor={`if-l${n}-rate`}>
                    <span className="ep-field__label">Estimated rate (₹)</span>
                    <input
                      id={`if-l${n}-rate`}
                      className="ep-input"
                      inputMode="decimal"
                      value={l.estRate}
                      onChange={(e) => setLine(i, { estRate: e.target.value, typed: true })}
                    />
                    <span className="ep-field__help">
                      {l.itemId ? sourceOf(l) : null}
                      {it && l.typed && (it.contractRate ?? it.lastRate) !== null ? (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            onClick={() => pickItem(i, l.itemId)}
                          >
                            Use {inr((it.contractRate ?? it.lastRate)!)}
                          </button>
                        </>
                      ) : null}
                    </span>
                  </label>
                ) : null}
                <label className="ep-field" htmlFor={`if-l${n}-note`}>
                  <span className="ep-field__label">Note</span>
                  <input
                    id={`if-l${n}-note`}
                    className="ep-input"
                    maxLength={300}
                    value={l.note}
                    placeholder="Size, make, colour…"
                    onChange={(e) => setLine(i, { note: e.target.value })}
                  />
                </label>
                {stock?.covers ? (
                  <label className="ep-field" htmlFor={`if-l${n}-why`}>
                    <span className="ep-field__label" data-required="true">
                      Why buy it? The store has enough
                    </span>
                    <input
                      id={`if-l${n}-why`}
                      className="ep-input"
                      maxLength={300}
                      value={l.stockReason}
                      placeholder="e.g. another size or make is needed"
                      aria-invalid={whyMissing || undefined}
                      aria-describedby={`if-l${n}-why-help${whyMissing ? ` if-l${n}-why-err` : ''}`}
                      onChange={(e) => setLine(i, { stockReason: e.target.value })}
                    />
                    <span id={`if-l${n}-why-help`} className="ep-field__help">
                      {`The stores have ${qtyWords(stock.free)} ${stock.unit} free, enough for this. Send it with the reason (the approvers see it), lower the quantity, or ask the store to issue it.`}
                    </span>
                    {whyMissing ? (
                      <span id={`if-l${n}-why-err`} className="ep-field__error" role="alert">
                        Say in a few words why it is bought
                      </span>
                    ) : null}
                  </label>
                ) : null}
                <div className="ep-field">
                  {showRates ? (
                    <>
                      <span className="ep-field__label">Amount</span>
                      <output className="ep-purch-amount" htmlFor={`if-l${n}-qty if-l${n}-rate`}>
                        {inr(amountOf(l))}
                      </output>
                    </>
                  ) : null}
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
            }}
          >
            {lines.length < 200 ? (
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setLines((cur) => [...cur, blank()])}
              >
                Add a line
              </button>
            ) : (
              <span />
            )}
            {showRates ? (
              <p className="ep-purch-total" aria-live="polite">
                Estimate: <strong>{inr(total)}</strong>
              </p>
            ) : null}
          </div>
        </div>
      </FormSection>

      {error ? (
        <p className="ep-field__error" role="alert">
          {error}
        </p>
      ) : null}
      <FormActions>
        <a
          className="ep-btn ep-btn--ghost"
          href={indent ? `/purchase/indents/${indent.id}` : '/purchase/indents'}
        >
          Cancel
        </a>
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={pending}
          onClick={() => send(false)}
        >
          Save as draft
        </button>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save and send for approval'}
        </button>
      </FormActions>
    </form>
  );
}
