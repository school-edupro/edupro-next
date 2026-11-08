'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { makeIssue } from '@/lib/purchase-actions';
import type { IssueFormLists, ToIssueGroup } from '@/lib/purchase';

interface Line {
  itemId: string;
  qty: string;
  batch: string;
}
const blank = (): Line => ({ itemId: '', qty: '', batch: '' });
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * An issue (docs/design/84, part 8). Against a requisition: its reserved lines in this store with what
 * is left (shared to the indents it came from, one issue per indent), who took it (else each indent's
 * raiser). At the counter: the store, the department, who took it, the purpose and the items (never
 * more than the free stock). A batch may be named; otherwise the earliest expiry goes first.
 */
export function IssueForm({
  lists,
  group,
}: {
  lists: IssueFormLists;
  /** issuing against a requisition's reservations in a store */
  group: ToIssueGroup | null;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(group?.storeId ?? lists.stores[0]?.id ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [takenBy, setTakenBy] = useState('');
  const [purpose, setPurpose] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [reserved, setReserved] = useState<Record<string, { qty: string; batch: string }>>(() =>
    Object.fromEntries(
      (group?.lines ?? []).map((l) => [l.reservationId, { qty: String(l.toIssue), batch: '' }]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stock = useMemo(
    () => lists.stock.filter((s) => s.storeId === storeId),
    [lists.stock, storeId],
  );
  const batchesOf = (itemId: string) =>
    lists.batches.filter((b) => b.storeId === storeId && b.itemId === itemId);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = () => {
    setError(null);
    const body = group
      ? {
          kind: 'indent',
          storeId: group.storeId,
          ...(group.indentId
            ? { indentId: group.indentId }
            : { requisitionId: group.requisitionId }),
          takenByEmployeeId: takenBy || null,
          lines: group.lines
            .map((l) => ({ l, v: reserved[l.reservationId]! }))
            .filter(({ v }) => Number(v.qty || 0) > 0)
            .map(({ l, v }) => ({
              reservationId: l.reservationId,
              qty: v.qty,
              ...(v.batch ? { batch: v.batch } : {}),
            })),
        }
      : {
          kind: 'counter',
          storeId,
          departmentId: departmentId || undefined,
          takenByEmployeeId: takenBy || undefined,
          purpose: purpose || undefined,
          lines: lines
            .filter((l) => l.itemId && l.qty)
            .map((l) => ({ itemId: l.itemId, qty: l.qty, ...(l.batch ? { batch: l.batch } : {}) })),
        };
    if (!body.lines.length) {
      setError('Give the quantity of at least one line');
      return;
    }
    start(async () => {
      const r = await makeIssue(body);
      if (r.ok)
        router.push(
          `/purchase/issues/${r.id}?ok=1&detail=${encodeURIComponent(`${r.number ?? 'Issue'} made${r.detail ? `: ${r.detail}` : ''}`)}`,
        );
      else setError(r.error);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="3">
        {group ? null : (
          <>
            <label className="ep-field" htmlFor="iss-store">
              <span className="ep-field__label" data-required="true">
                From the store
              </span>
              <select
                id="iss-store"
                className="ep-select"
                value={storeId}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setLines([blank()]);
                }}
              >
                {lists.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="iss-dept">
              <span className="ep-field__label" data-required="true">
                To the department
              </span>
              <select
                id="iss-dept"
                className="ep-select"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                <option value="">Pick the department</option>
                {lists.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="ep-field" htmlFor="iss-taker">
          <span className="ep-field__label" data-required={group ? undefined : 'true'}>
            Taken by
          </span>
          <select
            id="iss-taker"
            className="ep-select"
            value={takenBy}
            onChange={(e) => setTakenBy(e.target.value)}
          >
            <option value="">{group ? 'The indent’s raiser' : 'Pick the employee'}</option>
            {lists.staff.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.code}){x.department ? ` · ${x.department}` : ''}
              </option>
            ))}
          </select>
        </label>
        {group ? null : (
          <label className="ep-field" htmlFor="iss-purpose">
            <span className="ep-field__label" data-required="true">
              Purpose
            </span>
            <input
              id="iss-purpose"
              className="ep-input"
              maxLength={300}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="ep-purch-lines" style={{ marginTop: 'var(--sp-4)' }}>
        {group
          ? group.lines.map((l, i) => {
              const v = reserved[l.reservationId]!;
              const n = String(i + 1);
              const bs = l.tracksBatch ? batchesOf(l.itemId) : [];
              return (
                <fieldset key={l.reservationId} className="ep-purch-line ep-purch-line--wide">
                  <legend className="ep-purch-line__item">
                    {n}. {l.item} ({l.itemCode}) — reserved {fmt(l.reserved)} {l.unit}
                    {l.issued ? `, ${fmt(l.issued)} issued` : ''}; {fmt(l.inHand)} in hand
                  </legend>
                  <label className="ep-field" htmlFor={`iss-${n}-q`}>
                    <span className="ep-field__label">Issue now ({l.unit})</span>
                    <input
                      id={`iss-${n}-q`}
                      className="ep-input"
                      inputMode="decimal"
                      value={v.qty}
                      onChange={(e) =>
                        setReserved((cur) => ({
                          ...cur,
                          [l.reservationId]: { ...v, qty: e.target.value },
                        }))
                      }
                    />
                    <span className="ep-field__help">Up to {fmt(l.toIssue)}</span>
                  </label>
                  {bs.length ? (
                    <label className="ep-field" htmlFor={`iss-${n}-b`}>
                      <span className="ep-field__label">Batch</span>
                      <select
                        id={`iss-${n}-b`}
                        className="ep-select"
                        value={v.batch}
                        onChange={(e) =>
                          setReserved((cur) => ({
                            ...cur,
                            [l.reservationId]: { ...v, batch: e.target.value },
                          }))
                        }
                      >
                        <option value="">Earliest expiry first</option>
                        {bs.map((b) => (
                          <option key={`${b.batch}-${b.expiry ?? ''}`} value={b.batch}>
                            {b.batch}
                            {b.expiry ? ` · expires ${b.expiry}` : ''} · {fmt(b.qty)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </fieldset>
              );
            })
          : lines.map((l, i) => {
              const n = String(i + 1);
              const it = stock.find((s) => s.itemId === l.itemId);
              const bs = it?.tracksBatch ? batchesOf(l.itemId) : [];
              return (
                <fieldset key={i} className="ep-purch-line">
                  <legend className="ep-sr-only">Line {n}</legend>
                  <label className="ep-field" htmlFor={`iss-${n}-i`}>
                    <span className="ep-field__label">Item {n}</span>
                    <select
                      id={`iss-${n}-i`}
                      className="ep-select"
                      value={l.itemId}
                      onChange={(e) => setLine(i, { itemId: e.target.value, batch: '' })}
                    >
                      <option value="">Pick the item</option>
                      {stock.map((x) => (
                        <option key={x.itemId} value={x.itemId}>
                          {x.name} ({x.code}) — {fmt(x.free)} {x.unit} free
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor={`iss-${n}-q`}>
                    <span className="ep-field__label">Quantity{it ? ` (${it.unit})` : ''}</span>
                    <input
                      id={`iss-${n}-q`}
                      className="ep-input"
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })}
                    />
                  </label>
                  {bs.length ? (
                    <label className="ep-field" htmlFor={`iss-${n}-b`}>
                      <span className="ep-field__label">Batch</span>
                      <select
                        id={`iss-${n}-b`}
                        className="ep-select"
                        value={l.batch}
                        onChange={(e) => setLine(i, { batch: e.target.value })}
                      >
                        <option value="">Earliest expiry first</option>
                        {bs.map((b) => (
                          <option key={`${b.batch}-${b.expiry ?? ''}`} value={b.batch}>
                            {b.batch}
                            {b.expiry ? ` · expires ${b.expiry}` : ''} · {fmt(b.qty)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </fieldset>
              );
            })}
        {group ? null : (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            style={{ justifySelf: 'start' }}
            onClick={() => setLines((cur) => [...cur, blank()])}
          >
            Add a line
          </button>
        )}
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          Issue
        </button>
      </div>
    </form>
  );
}
