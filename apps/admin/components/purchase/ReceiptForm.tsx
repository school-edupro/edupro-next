'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { recordReceipt } from '@/lib/purchase-actions';
import type { ReceiptForm as FormData_ } from '@/lib/purchase';

interface Line {
  received: string;
  refused: string;
  refusedReason: string;
  batch: string;
  expiry: string;
  serials: string;
  workDone: string;
}
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/**
 * What came against a PO (docs/design/84, part 7): goods into a store — per line the quantity taken in
 * (what is still to come filled in), what was refused at the door with the reason, the batch and expiry
 * of an item kept by batch, serial numbers one per line — or, for services, the work done. The
 * vendor's challan / invoice and a photo or PDF of it. Only what is taken in goes for inspection.
 */
export function ReceiptForm({ form, kind }: { form: FormData_; kind: 'goods' | 'service' }) {
  const router = useRouter();
  const lines = form.lines.filter((l) => l.service === (kind === 'service'));
  const [state, setState] = useState<Record<string, Line>>(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          received: l.outstanding ? String(l.outstanding) : '',
          refused: '',
          refusedReason: '',
          batch: '',
          expiry: '',
          serials: '',
          workDone: '',
        },
      ]),
    ),
  );
  const mainOk = form.stores.some((s) => s.id === form.mainStoreId);
  const [storeId, setStoreId] = useState(mainOk ? form.mainStoreId : (form.stores[0]?.id ?? ''));
  const [head, setHead] = useState({
    receivedOn: today(),
    challanNo: '',
    challanDate: '',
    invoiceNo: '',
    invoiceDate: '',
    note: '',
  });
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<Line>) =>
    setState((cur) => ({ ...cur, [id]: { ...cur[id]!, ...patch } }));
  const goods = kind === 'goods';

  if (!lines.some((l) => l.outstanding > 0 || l.max > 0))
    return (
      <p className="ep-alert ep-alert--info" role="status">
        {goods
          ? 'Every goods line of this PO has come.'
          : 'Every service on this PO has been certified.'}
      </p>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const body = {
          orderId: form.order.id,
          kind,
          ...(goods ? { storeId } : {}),
          receivedOn: head.receivedOn,
          challanNo: head.challanNo || undefined,
          challanDate: head.challanDate || undefined,
          invoiceNo: head.invoiceNo || undefined,
          invoiceDate: head.invoiceDate || undefined,
          note: head.note || undefined,
          lines: lines
            .map((l) => ({ l, v: state[l.id]! }))
            .filter(({ v }) => Number(v.received || 0) > 0 || Number(v.refused || 0) > 0)
            .map(({ l, v }) => ({
              orderLineId: l.id,
              receivedQty: v.received || 0,
              refusedQty: v.refused || 0,
              refusedReason: v.refusedReason || undefined,
              batch: v.batch || undefined,
              expiry: v.expiry || undefined,
              serials: v.serials
                .split(/[\n,]+/)
                .map((x) => x.trim())
                .filter(Boolean),
              workDone: v.workDone || undefined,
            })),
        };
        if (!body.lines.length) {
          setError(goods ? 'Give the quantity received on a line' : 'Give the work done on a line');
          return;
        }
        const fd = new FormData();
        fd.set('body', JSON.stringify(body));
        const f = file.current?.files?.[0];
        if (f) fd.set('file', f);
        start(async () => {
          const r = await recordReceipt(fd);
          if (r.ok)
            router.push(
              `/purchase/receipts/${r.id}?ok=1&detail=${encodeURIComponent(`${r.number} recorded: it waits for inspection`)}`,
            );
          else setError(r.error);
        });
      }}
      noValidate
    >
      <div className="ep-form-row" data-columns="3">
        {goods ? (
          <label className="ep-field" htmlFor="rc-store">
            <span className="ep-field__label" data-required="true">
              Store
            </span>
            <select
              id="rc-store"
              className="ep-select"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              {form.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="rc-day">
          <span className="ep-field__label" data-required="true">
            {goods ? 'Received on' : 'Work done on'}
          </span>
          <input
            id="rc-day"
            type="date"
            className="ep-input"
            max={today()}
            min={form.order.poDate}
            value={head.receivedOn}
            onChange={(e) => setHead({ ...head, receivedOn: e.target.value })}
          />
        </label>
        <label className="ep-field" htmlFor="rc-cn">
          <span className="ep-field__label">Delivery challan no.</span>
          <input
            id="rc-cn"
            className="ep-input"
            maxLength={60}
            value={head.challanNo}
            onChange={(e) => setHead({ ...head, challanNo: e.target.value })}
          />
        </label>
        <label className="ep-field" htmlFor="rc-cd">
          <span className="ep-field__label">Challan date</span>
          <input
            id="rc-cd"
            type="date"
            className="ep-input"
            value={head.challanDate}
            onChange={(e) => setHead({ ...head, challanDate: e.target.value })}
          />
        </label>
        <label className="ep-field" htmlFor="rc-in">
          <span className="ep-field__label">Invoice no.</span>
          <input
            id="rc-in"
            className="ep-input"
            maxLength={60}
            value={head.invoiceNo}
            onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })}
          />
        </label>
        <label className="ep-field" htmlFor="rc-id">
          <span className="ep-field__label">Invoice date</span>
          <input
            id="rc-id"
            type="date"
            className="ep-input"
            value={head.invoiceDate}
            onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })}
          />
        </label>
        <label className="ep-field" htmlFor="rc-file">
          <span className="ep-field__label">
            {goods ? 'Photo or PDF of the challan / invoice' : 'Photo or PDF of the work'}
          </span>
          <input
            id="rc-file"
            ref={file}
            type="file"
            className="ep-input"
            accept="application/pdf,image/jpeg,image/png,image/webp"
          />
        </label>
      </div>

      <div className="ep-purch-lines" style={{ marginTop: 'var(--sp-4)' }}>
        {lines.map((l) => {
          const v = state[l.id]!;
          const n = String(l.seq);
          const done = l.max <= 0;
          return (
            <fieldset key={l.id} className="ep-purch-line ep-purch-line--wide" disabled={done}>
              <legend className="ep-purch-line__item">
                {n}. {l.description}
                {l.itemCode ? ` (${l.itemCode})` : ''} — ordered {qty(l.ordered)} {l.uom}
                {l.received ? `, received ${qty(l.received)}` : ''}
                {l.rejected ? `, rejected ${qty(l.rejected)}` : ''}
                {l.waiting ? `, ${qty(l.waiting)} waiting for inspection` : ''}
                {done ? ' — all received' : `; still to come ${qty(l.outstanding)}`}
                {l.perUnit !== 1 && l.storeUom
                  ? ` (1 ${l.uom} = ${qty(l.perUnit)} ${l.storeUom})`
                  : ''}
              </legend>
              <label className="ep-field" htmlFor={`rc-${n}-q`}>
                <span className="ep-field__label">
                  {goods ? `Received (${l.uom})` : `Done (${l.uom})`}
                </span>
                <input
                  id={`rc-${n}-q`}
                  className="ep-input"
                  inputMode="decimal"
                  value={v.received}
                  onChange={(e) => set(l.id, { received: e.target.value })}
                  aria-describedby={`rc-${n}-max`}
                />
                <span id={`rc-${n}-max`} className="ep-field__help">
                  Up to {qty(l.max)}
                  {form.tolerancePct ? ` (${String(form.tolerancePct)}% over allowed)` : ''}
                </span>
              </label>
              {goods ? (
                <>
                  <label className="ep-field" htmlFor={`rc-${n}-f`}>
                    <span className="ep-field__label">Refused at the door</span>
                    <input
                      id={`rc-${n}-f`}
                      className="ep-input"
                      inputMode="decimal"
                      value={v.refused}
                      onChange={(e) => set(l.id, { refused: e.target.value })}
                    />
                  </label>
                  {Number(v.refused || 0) > 0 ? (
                    <label className="ep-field" htmlFor={`rc-${n}-fr`}>
                      <span className="ep-field__label" data-required="true">
                        Why refused
                      </span>
                      <input
                        id={`rc-${n}-fr`}
                        className="ep-input"
                        maxLength={300}
                        placeholder="Damaged, wrong item, more than ordered…"
                        value={v.refusedReason}
                        onChange={(e) => set(l.id, { refusedReason: e.target.value })}
                      />
                    </label>
                  ) : null}
                  {l.tracksBatch ? (
                    <>
                      <label className="ep-field" htmlFor={`rc-${n}-b`}>
                        <span className="ep-field__label" data-required="true">
                          Batch
                        </span>
                        <input
                          id={`rc-${n}-b`}
                          className="ep-input"
                          maxLength={40}
                          value={v.batch}
                          onChange={(e) => set(l.id, { batch: e.target.value })}
                        />
                      </label>
                      <label className="ep-field" htmlFor={`rc-${n}-e`}>
                        <span className="ep-field__label">Expiry</span>
                        <input
                          id={`rc-${n}-e`}
                          type="date"
                          className="ep-input"
                          value={v.expiry}
                          onChange={(e) => set(l.id, { expiry: e.target.value })}
                        />
                      </label>
                    </>
                  ) : null}
                  {l.tracksSerial ? (
                    <label className="ep-field" htmlFor={`rc-${n}-s`}>
                      <span className="ep-field__label">Serial numbers (one per line)</span>
                      <textarea
                        id={`rc-${n}-s`}
                        className="ep-input"
                        rows={3}
                        value={v.serials}
                        onChange={(e) => set(l.id, { serials: e.target.value })}
                      />
                    </label>
                  ) : null}
                </>
              ) : (
                <label className="ep-field" htmlFor={`rc-${n}-w`}>
                  <span className="ep-field__label" data-required="true">
                    What was done
                  </span>
                  <textarea
                    id={`rc-${n}-w`}
                    className="ep-input"
                    rows={2}
                    maxLength={1000}
                    value={v.workDone}
                    onChange={(e) => set(l.id, { workDone: e.target.value })}
                  />
                </label>
              )}
            </fieldset>
          );
        })}
      </div>
      <label className="ep-field" htmlFor="rc-note">
        <span className="ep-field__label">Note</span>
        <textarea
          id="rc-note"
          className="ep-input"
          rows={2}
          maxLength={1000}
          value={head.note}
          onChange={(e) => setHead({ ...head, note: e.target.value })}
        />
      </label>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={pending}>
          {goods ? 'Record the receipt' : 'Record the work done'}
        </button>
      </div>
    </form>
  );
}
