'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition, type MouseEvent } from 'react';
import { importCount, saveCountLines, submitCountNow } from '@/lib/purchase-actions';
import { COUNT_REASONS, type CountDetail, type CountReason } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
interface Entry {
  counted: string;
  code: CountReason | '';
  note: string;
}

/**
 * Counting a store a page at a time (docs/design/84, part 8; "As built — the count rebuilt", 9 Nov
 * 2026): the lines of this page (found by the page's filters), what is on the shelf (the book
 * quantity shows only once a line is counted), why a line differs (from the list, and a note); an item
 * or batch found that is not listed; or the filled Excel sheet for everything at once. Save saves this
 * page's changed lines; leaving a page with changes asks first. The bar at the foot stays in view.
 */
export function CountSheet({
  count,
  items,
  pager,
}: {
  count: CountDetail;
  /** the items kept in stock, for a line found that is not listed */
  items: Array<{ id: string; code: string; name: string; tracksBatch: boolean }>;
  pager: {
    page: number;
    pages: number;
    found: number;
    first: string;
    prev: string;
    next: string;
    last: string;
  };
}) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      Object.fromEntries(
        count.lineItems.map((l) => [
          l.id,
          {
            counted: l.counted === null ? '' : String(l.counted),
            code: (l.reasonCode ?? '') as CountReason | '',
            note: l.reason ?? '',
          },
        ]),
      ) as Record<string, Entry>,
    [count.lineItems],
  );
  const [state, setState] = useState(initial);
  useEffect(() => setState(initial), [initial]);
  const [countedBy, setCountedBy] = useState(count.countedBy ?? '');
  const [extra, setExtra] = useState({ itemId: '', batch: '', expiry: '', counted: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = count.lineItems.filter((l) => {
    const a = state[l.id];
    const b = initial[l.id];
    return a && b && (a.counted !== b.counted || a.code !== b.code || a.note !== b.note);
  });
  const dirty = changed.length > 0 || countedBy !== (count.countedBy ?? '') || extra.itemId !== '';
  // leaving the page (another page, a filter, closing the tab) with changes asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const go = (e: MouseEvent) => {
    if (dirty && !window.confirm('This page has changes not saved. Leave it without saving?'))
      e.preventDefault();
  };
  const body = () => {
    const lines: Array<Record<string, unknown>> = changed.map((l) => {
      const v = state[l.id]!;
      return {
        lineId: l.id,
        countedQty: v.counted === '' ? null : v.counted,
        reason: v.note.trim() || undefined,
        reasonCode: v.code || undefined,
      };
    });
    if (extra.itemId && extra.counted !== '')
      lines.push({
        itemId: extra.itemId,
        batch: extra.batch || undefined,
        expiry: extra.expiry || undefined,
        countedQty: extra.counted,
        reasonCode: 'found',
      });
    return { countedBy: countedBy || undefined, lines };
  };
  const save = (send: boolean) => {
    setMsg(null);
    start(async () => {
      const b = body();
      if (b.lines.length || countedBy !== (count.countedBy ?? '')) {
        const r = await saveCountLines(count.id, b);
        if (!r.ok) return setMsg({ ok: false, text: r.error });
      }
      setExtra({ itemId: '', batch: '', expiry: '', counted: '' });
      if (send) {
        const s = await submitCountNow(count.id);
        if (!s.ok) {
          setMsg({ ok: false, text: `Saved, but not sent: ${s.error}` });
          return router.refresh();
        }
        setMsg({ ok: true, text: 'Saved and sent for approval' });
      } else
        setMsg({
          ok: true,
          text: `Saved ${String(b.lines.length)} line${b.lines.length === 1 ? '' : 's'}`,
        });
      router.refresh();
    });
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      start(async () => {
        const r = await importCount(count.id, s.slice(s.indexOf(',') + 1));
        setMsg(
          r.ok
            ? { ok: true, text: r.detail ?? 'Counted from the sheet' }
            : { ok: false, text: r.error },
        );
        if (r.ok) router.refresh();
      });
    };
    reader.readAsDataURL(f);
  };
  const extraItem = items.find((i) => i.id === extra.itemId);
  const left = count.figures.lines - count.figures.counted;
  return (
    <>
      <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/purchase/stock-doc/counts/${count.id}?sheet=1`}
        >
          Count sheet (Excel)
        </a>
        <label className="ep-field" htmlFor="cs-file">
          <span className="ep-field__label">Upload the filled sheet (every line at once)</span>
          <input
            id="cs-file"
            type="file"
            className="ep-input"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        noValidate
      >
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="The count sheet">
          <table className="ep-table">
            <caption className="ep-sr-only">
              The count sheet: what is on the shelf, the book once counted, and why a line differs
            </caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Counted
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Book
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Difference
                </th>
                <th scope="col">Why it differs</th>
              </tr>
            </thead>
            <tbody>
              {count.lineItems.length ? (
                count.lineItems.map((l) => {
                  const v = state[l.id] ?? { counted: '', code: '', note: '' };
                  const set = (patch: Partial<Entry>) =>
                    setState((cur) => ({ ...cur, [l.id]: { ...v, ...patch } }));
                  const differs = l.difference !== null && l.difference !== 0;
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.item} ({l.itemCode})
                        <span className="ep-mr-col__desc">
                          {[
                            l.category,
                            l.batch ? `Batch ${l.batch}` : null,
                            l.expiry ? `expiry ${l.expiry}` : null,
                            l.added ? 'found, not listed' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <input
                          className="ep-input"
                          style={{ maxWidth: '7rem', textAlign: 'right' }}
                          inputMode="decimal"
                          aria-label={`Counted: ${l.item}${l.batch ? ` batch ${l.batch}` : ''} (${l.unit})`}
                          value={v.counted}
                          onChange={(e) => set({ counted: e.target.value })}
                        />{' '}
                        {l.unit}
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.book === null ? '—' : fmt(l.book)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {differs ? (
                          <Badge tone={l.difference! > 0 ? 'info' : 'danger'}>
                            {l.difference! > 0 ? '+' : ''}
                            {fmt(l.difference!)}
                          </Badge>
                        ) : l.difference === 0 ? (
                          <Badge tone="success">Matches</Badge>
                        ) : (
                          ''
                        )}
                      </td>
                      <td style={{ minWidth: '16rem' }}>
                        <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                          <select
                            className="ep-select"
                            aria-label={`Why ${l.item} differs`}
                            value={v.code}
                            onChange={(e) => set({ code: e.target.value as CountReason | '' })}
                          >
                            <option value="">{differs ? 'Pick why…' : '—'}</option>
                            {(Object.keys(COUNT_REASONS) as CountReason[]).map((key) => (
                              <option key={key} value={key}>
                                {COUNT_REASONS[key]}
                              </option>
                            ))}
                          </select>
                          {v.code ? (
                            <input
                              className="ep-input"
                              maxLength={300}
                              aria-label={`Note: ${l.item}`}
                              placeholder={
                                v.code === 'other' ? 'Say what (needed)' : 'A note (optional)'
                              }
                              value={v.note}
                              onChange={(e) => set({ note: e.target.value })}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5}>No line matches these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <nav aria-label="Pages of the count" className="ep-field__help">
          {pager.found} line{pager.found === 1 ? '' : 's'} found
          {pager.pages > 1 ? (
            <>
              {' '}
              · page {pager.page} of {pager.pages} ·{' '}
              {pager.page > 1 ? (
                <>
                  <a href={pager.first} onClick={go}>
                    First
                  </a>{' '}
                  <a href={pager.prev} onClick={go}>
                    Previous
                  </a>
                </>
              ) : null}{' '}
              {pager.page < pager.pages ? (
                <>
                  <a href={pager.next} onClick={go}>
                    Next
                  </a>{' '}
                  <a href={pager.last} onClick={go}>
                    Last
                  </a>
                </>
              ) : null}
            </>
          ) : null}
        </nav>
        <fieldset
          className="ep-purch-line ep-purch-line--wide"
          style={{ marginTop: 'var(--sp-3)' }}
        >
          <legend className="ep-purch-line__item">Found, not on the list</legend>
          <label className="ep-field" htmlFor="cs-x-item">
            <span className="ep-field__label">Item</span>
            <select
              id="cs-x-item"
              className="ep-select"
              value={extra.itemId}
              onChange={(e) => setExtra({ ...extra, itemId: e.target.value })}
            >
              <option value="">Pick the item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </select>
          </label>
          {extraItem?.tracksBatch ? (
            <>
              <label className="ep-field" htmlFor="cs-x-batch">
                <span className="ep-field__label">Batch</span>
                <input
                  id="cs-x-batch"
                  className="ep-input"
                  maxLength={40}
                  value={extra.batch}
                  onChange={(e) => setExtra({ ...extra, batch: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor="cs-x-exp">
                <span className="ep-field__label">Expiry</span>
                <input
                  id="cs-x-exp"
                  type="date"
                  className="ep-input"
                  value={extra.expiry}
                  onChange={(e) => setExtra({ ...extra, expiry: e.target.value })}
                />
              </label>
            </>
          ) : null}
          <label className="ep-field" htmlFor="cs-x-q">
            <span className="ep-field__label">Counted</span>
            <input
              id="cs-x-q"
              className="ep-input"
              inputMode="decimal"
              value={extra.counted}
              onChange={(e) => setExtra({ ...extra, counted: e.target.value })}
            />
          </label>
        </fieldset>
        <label className="ep-field" htmlFor="cs-by" style={{ marginTop: 'var(--sp-3)' }}>
          <span className="ep-field__label">Counted by (names of the verifiers)</span>
          <input
            id="cs-by"
            className="ep-input"
            maxLength={200}
            value={countedBy}
            onChange={(e) => setCountedBy(e.target.value)}
          />
        </label>
        {msg ? (
          <p
            className={msg.ok ? 'ep-alert ep-alert--success' : 'ep-alert ep-alert--danger'}
            role={msg.ok ? 'status' : 'alert'}
          >
            {msg.text}
          </p>
        ) : null}
        <div className="ep-form-actions" data-sticky="true">
          <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
            Save this page
          </button>
          {count.can.submit ? (
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={() => save(true)}
            >
              Save and send for approval
            </button>
          ) : null}
          <span className="ep-field__help" style={{ alignSelf: 'center', margin: 0 }} role="status">
            {dirty
              ? `${String(changed.length)} change${changed.length === 1 ? '' : 's'} not saved · `
              : ''}
            {left
              ? `${String(left)} line${left === 1 ? '' : 's'} still to count in all`
              : 'Every line counted'}
          </span>
        </div>
      </form>
    </>
  );
}
