'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { FormActions, FormRow, FormSection } from '@edupro/ui';
import { saveRequisition } from '@/lib/purchase-actions';
import { inr, type RequisitionDetail, type RequisitionFormLists } from '@/lib/purchase';

const FREE = 'free';

interface Line {
  /** a line already on the PR */
  id: string | null;
  /** its indent lines (it stays on the PR; its item may be matched, its quantity changed) */
  from: string;
  itemId: string;
  freeText: string;
  quantity: string;
  uomId: string;
  estRate: string;
  fulfil: 'buy' | 'store';
  storeNote: string;
  note: string;
}
const blank = (): Line => ({
  id: null,
  from: '',
  itemId: '',
  freeText: '',
  quantity: '',
  uomId: '',
  estRate: '',
  fulfil: 'buy',
  storeNote: '',
  note: '',
});

/**
 * A direct Purchase Requisition, or a PR's header and lines changed (docs/design/83, part 3): each line
 * a catalogue item (a line asked for in words can be matched to one here) or one in words with its
 * unit, the quantity, the estimated rate, and whether it is bought or issued from the store (with what
 * is issued). A line that came from an indent stays. What was typed stays on a refusal.
 */
export function RequisitionForm({
  pr,
  lists,
}: {
  pr: RequisitionDetail | null;
  lists: RequisitionFormLists;
}) {
  const router = useRouter();
  const items = useMemo(() => new Map(lists.items.map((i) => [i.id, i])), [lists.items]);
  const byCategory = useMemo(() => {
    const m = new Map<string, RequisitionFormLists['items']>();
    for (const i of lists.items) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [lists.items]);
  const [head, setHead] = useState({
    departmentId: pr?.departmentId ?? '',
    purpose: pr?.purpose ?? '',
    requiredBy: pr?.requiredBy ?? '',
  });
  const [lines, setLines] = useState<Line[]>(
    pr?.lineItems.length
      ? pr.lineItems.map((l) => ({
          id: l.id,
          from: l.sources.map((s) => s.number).join(', '),
          itemId: l.itemId ?? FREE,
          freeText: l.itemId ? '' : l.item,
          quantity: String(l.quantity),
          uomId: l.uomId,
          estRate: String(l.estRate),
          fulfil: l.fulfil,
          storeNote: l.storeNote ?? '',
          note: l.note ?? '',
        }))
      : [blank()],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const it = items.get(itemId);
    setLine(i, {
      itemId,
      uomId: it ? it.uomId : lines[i]!.uomId,
      // a new line takes the item's list rate; a line from an indent keeps its estimate
      estRate: !lines[i]!.id && it && it.rate !== null ? String(it.rate) : lines[i]!.estRate,
    });
  };
  const amountOf = (l: Line) => {
    const q = Number(l.quantity);
    const r = Number(l.estRate);
    return l.fulfil === 'buy' && Number.isFinite(q) && Number.isFinite(r)
      ? Math.round(q * r * 100) / 100
      : 0;
  };
  const total = lines.reduce((s, l) => s + amountOf(l), 0);

  const send = () => {
    setError(null);
    const body = {
      ...(pr ? {} : { departmentId: head.departmentId || undefined }),
      purpose: head.purpose,
      ...(head.requiredBy ? { requiredBy: head.requiredBy } : pr ? { requiredBy: null } : {}),
      lines: lines
        .filter((l) => l.id || l.itemId || l.freeText.trim() || l.quantity)
        .map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          ...(l.itemId && l.itemId !== FREE
            ? { itemId: l.itemId }
            : { freeText: l.freeText || undefined, uomId: l.uomId || undefined }),
          quantity: l.quantity,
          ...(l.estRate !== '' ? { estRate: l.estRate } : {}),
          fulfil: l.fulfil,
          ...(l.fulfil === 'store' ? { storeNote: l.storeNote } : {}),
          ...(l.note.trim() ? { note: l.note } : {}),
        })),
    };
    start(async () => {
      const r = await saveRequisition(pr?.id ?? null, body);
      if (r.ok) {
        router.push(
          `/purchase/requisitions/${r.id}?ok=1&detail=${encodeURIComponent(pr ? 'Requisition saved' : 'Requisition made: now source it')}`,
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
      <FormSection title="The requisition">
        <FormRow columns={3}>
          {pr ? (
            <div className="ep-field">
              <span className="ep-field__label">Department</span>
              <span className="ep-purch-amount">
                {pr.department}
                {pr.combined ? ' (combined)' : ''}
              </span>
            </div>
          ) : (
            <label className="ep-field" htmlFor="rf-dept">
              <span className="ep-field__label" data-required="true">
                Department
              </span>
              <select
                id="rf-dept"
                className="ep-select"
                value={head.departmentId}
                onChange={(e) => setHead((h) => ({ ...h, departmentId: e.target.value }))}
              >
                <option value="">Pick the department</option>
                {lists.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">Its requisition levels approve it.</span>
            </label>
          )}
          <label className="ep-field" htmlFor="rf-purpose">
            <span className="ep-field__label" data-required="true">
              Purpose
            </span>
            <input
              id="rf-purpose"
              className="ep-input"
              maxLength={500}
              value={head.purpose}
              onChange={(e) => setHead((h) => ({ ...h, purpose: e.target.value }))}
            />
          </label>
          <label className="ep-field" htmlFor="rf-by">
            <span className="ep-field__label">Needed by</span>
            <input
              id="rf-by"
              type="date"
              className="ep-input"
              min={today}
              value={head.requiredBy}
              onChange={(e) => setHead((h) => ({ ...h, requiredBy: e.target.value }))}
            />
          </label>
        </FormRow>
      </FormSection>

      <FormSection
        title="Lines"
        description="Buy a line, or issue it from the store (say what is issued). A line asked for in words can be matched to an item from the list here."
      >
        <div className="ep-purch-lines">
          {lines.map((l, i) => {
            const it = items.get(l.itemId);
            const free = l.itemId === FREE;
            const n = String(i + 1);
            return (
              <fieldset key={i} className="ep-purch-line ep-purch-line--wide">
                <legend className="ep-sr-only">Line {n}</legend>
                <label className="ep-field ep-purch-line__item" htmlFor={`rf-l${n}-item`}>
                  <span className="ep-field__label" data-required="true">
                    Item {n}
                    {l.from ? ` · from ${l.from}` : ''}
                  </span>
                  <select
                    id={`rf-l${n}-item`}
                    className="ep-select"
                    value={l.itemId}
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
                    <option value={FREE}>Not in the list: in words</option>
                  </select>
                </label>
                {free ? (
                  <>
                    <label className="ep-field" htmlFor={`rf-l${n}-text`}>
                      <span className="ep-field__label" data-required="true">
                        In words
                      </span>
                      <input
                        id={`rf-l${n}-text`}
                        className="ep-input"
                        maxLength={300}
                        value={l.freeText}
                        onChange={(e) => setLine(i, { freeText: e.target.value })}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`rf-l${n}-uom`}>
                      <span className="ep-field__label" data-required="true">
                        Unit
                      </span>
                      <select
                        id={`rf-l${n}-uom`}
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
                <label className="ep-field" htmlFor={`rf-l${n}-qty`}>
                  <span className="ep-field__label" data-required="true">
                    Quantity{it ? ` (${it.uom})` : ''}
                  </span>
                  <input
                    id={`rf-l${n}-qty`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`rf-l${n}-rate`}>
                  <span className="ep-field__label">Estimated rate (₹)</span>
                  <input
                    id={`rf-l${n}-rate`}
                    className="ep-input"
                    inputMode="decimal"
                    value={l.estRate}
                    onChange={(e) => setLine(i, { estRate: e.target.value })}
                  />
                </label>
                <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="ep-field__label">Line {n}</legend>
                  <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                    {(
                      [
                        ['buy', 'Buy'],
                        ['store', 'From the store'],
                      ] as const
                    ).map(([v, label]) => (
                      <label key={v} className="ep-check" htmlFor={`rf-l${n}-${v}`}>
                        <input
                          id={`rf-l${n}-${v}`}
                          className="ep-check__input"
                          type="radio"
                          name={`rf-l${n}-fulfil`}
                          checked={l.fulfil === v}
                          onChange={() => setLine(i, { fulfil: v })}
                        />
                        <span className="ep-check__box" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {l.fulfil === 'store' ? (
                  <label className="ep-field" htmlFor={`rf-l${n}-store`}>
                    <span className="ep-field__label" data-required="true">
                      What the store issues
                    </span>
                    <input
                      id={`rf-l${n}-store`}
                      className="ep-input"
                      maxLength={300}
                      value={l.storeNote}
                      placeholder="e.g. 20 from the stock room"
                      onChange={(e) => setLine(i, { storeNote: e.target.value })}
                    />
                  </label>
                ) : (
                  <label className="ep-field" htmlFor={`rf-l${n}-note`}>
                    <span className="ep-field__label">Note</span>
                    <input
                      id={`rf-l${n}-note`}
                      className="ep-input"
                      maxLength={300}
                      value={l.note}
                      onChange={(e) => setLine(i, { note: e.target.value })}
                    />
                  </label>
                )}
                <div className="ep-field">
                  <span className="ep-field__label">Amount</span>
                  <output className="ep-purch-amount" htmlFor={`rf-l${n}-qty rf-l${n}-rate`}>
                    {l.fulfil === 'store' ? 'From the store' : inr(amountOf(l))}
                  </output>
                  {!l.id || !l.from ? (
                    lines.length > 1 ? (
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                      >
                        Remove line {n}
                      </button>
                    ) : null
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
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() => setLines((cur) => [...cur, blank()])}
            >
              Add a line
            </button>
            <p className="ep-purch-total" aria-live="polite">
              Estimate of what is bought: <strong>{inr(total)}</strong>
            </p>
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
          href={pr ? `/purchase/requisitions/${pr.id}` : '/purchase/requisitions'}
        >
          Cancel
        </a>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {pending ? 'Saving…' : pr ? 'Save' : 'Make the requisition'}
        </button>
      </FormActions>
    </form>
  );
}
