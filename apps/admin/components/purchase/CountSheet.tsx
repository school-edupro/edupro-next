'use client';
import { Badge } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { importCount, saveCountLines, submitCountNow } from '@/lib/purchase-actions';
import { COUNT_REASONS, type CountDetail, type CountReason } from '@/lib/purchase';

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
type Show = 'all' | 'todo' | 'diff';
interface Entry {
  counted: string;
  code: CountReason | '';
  note: string;
}

/**
 * Counting a store (docs/design/84, part 8; "As built — the count rebuilt", 9 Nov 2026): find a line by
 * name or code, by category, those not yet counted or those that differ; enter what is on the shelf
 * (the book quantity shows only once a line is counted); pick why a line differs (and a note); add an
 * item or batch found that is not listed; or upload the filled Excel sheet. The bar at the foot stays
 * in view: Save, or Save and send for approval.
 */
export function CountSheet({
  count,
  items,
}: {
  count: CountDetail;
  /** the items kept in stock, for a line found that is not listed */
  items: Array<{ id: string; code: string; name: string; tracksBatch: boolean }>;
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
  const [countedBy, setCountedBy] = useState(count.countedBy ?? '');
  const [extra, setExtra] = useState({ itemId: '', batch: '', expiry: '', counted: '' });
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const categories = [...new Set(count.lineItems.map((l) => l.category))].sort();
  const dirty =
    countedBy !== (count.countedBy ?? '') ||
    extra.itemId !== '' ||
    count.lineItems.some((l) => {
      const a = state[l.id]!;
      const b = initial[l.id]!;
      return a.counted !== b.counted || a.code !== b.code || a.note !== b.note;
    });
  const needle = q.trim().toLowerCase();
  const rows = count.lineItems.filter((l) => {
    const v = state[l.id]!;
    return (
      (!needle || `${l.item} ${l.itemCode} ${l.batch ?? ''}`.toLowerCase().includes(needle)) &&
      (!cat || l.category === cat) &&
      (show === 'all' ||
        (show === 'todo' ? v.counted === '' : l.difference !== null && l.difference !== 0))
    );
  });
  const body = () => {
    const lines: Array<Record<string, unknown>> = count.lineItems.map((l) => {
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
      const r = await saveCountLines(count.id, body());
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setExtra({ itemId: '', batch: '', expiry: '', counted: '' });
      if (send) {
        const s = await submitCountNow(count.id);
        if (!s.ok) {
          setMsg({ ok: false, text: `Saved, but not sent: ${s.error}` });
          return router.refresh();
        }
        setMsg({ ok: true, text: 'Saved and sent for approval' });
      } else setMsg({ ok: true, text: 'Saved' });
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
  const left = count.lineItems.filter((l) => state[l.id]!.counted === '').length;
  return (
    <>
      <div className="ep-grid__toolbar">
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/purchase/stock-doc/counts/${count.id}?sheet=1`}
        >
          Count sheet (Excel)
        </a>
        <label className="ep-field" htmlFor="cs-file">
          <span className="ep-field__label">Upload the filled sheet</span>
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
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <label className="ep-field" htmlFor="cs-q">
            <span className="ep-field__label">Find</span>
            <input
              id="cs-q"
              className="ep-input"
              type="search"
              value={q}
              placeholder="Item, code or batch"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          {categories.length > 1 ? (
            <label className="ep-field" htmlFor="cs-cat">
              <span className="ep-field__label">Category</span>
              <select
                id="cs-cat"
                className="ep-select"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="ep-field" htmlFor="cs-show">
            <span className="ep-field__label">Show</span>
            <select
              id="cs-show"
              className="ep-select"
              value={show}
              onChange={(e) => setShow(e.target.value as Show)}
            >
              <option value="all">Every line</option>
              <option value="todo">Not yet counted ({left})</option>
              <option value="diff">With a difference</option>
            </select>
          </label>
        </div>
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
              {rows.length ? (
                rows.map((l) => {
                  const v = state[l.id]!;
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
                            {(Object.keys(COUNT_REASONS) as CountReason[]).map((k) => (
                              <option key={k} value={k}>
                                {COUNT_REASONS[k]}
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
                  <td colSpan={5}>No line matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
            Save
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
            {dirty ? 'Changes not saved yet · ' : ''}
            {left
              ? `${String(left)} line${left === 1 ? '' : 's'} still to count`
              : 'Every line counted'}
          </span>
        </div>
      </form>
    </>
  );
}
