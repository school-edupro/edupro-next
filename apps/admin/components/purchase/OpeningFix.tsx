'use client';
import { Button, Dialog } from '@edupro/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { fixOpening } from '@/lib/purchase-actions';

interface Line {
  qty: string;
  rate: string;
  batch: string;
  expiry: string;
}

/**
 * Change or remove one item's opening stock while it has not moved since (docs/design/84, "As built —
 * opening stock corrections", 9 Nov 2026). Change: the lines it should have been (per batch for an item
 * kept by batch), then why; the wrong lines are reversed and the right ones posted, nothing deleted.
 * Remove: the item should not have been opened here at all.
 */
export function OpeningFix({
  storeId,
  itemId,
  name,
  unit,
  batch,
  asset,
  lines,
  mode,
}: {
  storeId: string;
  itemId: string;
  name: string;
  unit: string;
  /** kept by batch: a line per batch */
  batch: boolean;
  asset: boolean;
  /** the item's standing opening lines */
  lines: Array<{ qty: number; rate: number; batch: string | null; expiry: string | null }>;
  mode: 'change' | 'remove';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Line[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const begin = () => {
    setRows(
      lines.map((l) => ({
        qty: String(l.qty),
        rate: String(l.rate),
        batch: l.batch ?? '',
        expiry: l.expiry ?? '',
      })),
    );
    setReason('');
    setError(null);
    setOpen(true);
  };
  const set = (i: number, patch: Partial<Line>) =>
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
  const save = () => {
    setError(null);
    if (reason.trim().length < 3) return setError('Say why (at least 3 letters)');
    if (mode === 'change') {
      const bad = rows.find(
        (r) =>
          !(Number(r.qty) > 0) ||
          r.rate === '' ||
          !(Number(r.rate) >= 0) ||
          (batch && !r.batch.trim()),
      );
      if (bad || !rows.length)
        return setError(
          batch
            ? 'Each line needs its batch, a quantity above 0 and a rate'
            : 'Give a quantity above 0 and a rate',
        );
    }
    start(async () => {
      const r = await fixOpening(storeId, {
        itemId,
        reason: reason.trim(),
        lines:
          mode === 'remove'
            ? []
            : rows.map((x) => ({
                qty: x.qty,
                rate: x.rate,
                ...(batch && x.batch ? { batch: x.batch.trim() } : {}),
                ...(batch && x.expiry ? { expiry: x.expiry } : {}),
              })),
      });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  };
  const id = `of-${mode}-${itemId}`;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={mode === 'change' ? 'secondary' : 'ghost'}
        onClick={begin}
      >
        {mode === 'change' ? 'Change' : 'Remove'}
      </Button>
      {open ? (
        <Dialog
          open
          size={batch ? 'lg' : 'md'}
          title={
            mode === 'change' ? `Change the opening of ${name}` : `Remove ${name} from the opening`
          }
          onClose={() => !pending && setOpen(false)}
          primary={{
            label: mode === 'change' ? 'Correct the opening' : 'Remove it',
            variant: mode === 'change' ? 'primary' : 'danger',
            onClick: save,
            loading: pending,
          }}
        >
          <p style={{ marginTop: 0 }}>
            {mode === 'change'
              ? `What the store held on its first day, in ${unit}. The wrong line is reversed and this one posted; the item's register shows both.`
              : `The opening of ${name} is reversed in full: nothing of it stays in the store.`}
            {asset
              ? mode === 'change'
                ? ' Its assets keep their tags and take the new cost; one is added or removed for each unit more or less.'
                : ' Its assets made from the opening are taken off the register.'
              : ''}
          </p>
          {mode === 'change' ? (
            <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              {rows.map((r, i) => (
                <fieldset key={i} className="ep-purch-line">
                  <legend className="ep-sr-only">Line {i + 1}</legend>
                  {batch ? (
                    <>
                      <label className="ep-field" htmlFor={`${id}-${String(i)}-b`}>
                        <span className="ep-field__label" data-required="true">
                          Batch
                        </span>
                        <input
                          id={`${id}-${String(i)}-b`}
                          className="ep-input"
                          maxLength={40}
                          value={r.batch}
                          onChange={(e) => set(i, { batch: e.target.value })}
                        />
                      </label>
                      <label className="ep-field" htmlFor={`${id}-${String(i)}-e`}>
                        <span className="ep-field__label">Expiry</span>
                        <input
                          id={`${id}-${String(i)}-e`}
                          type="date"
                          className="ep-input"
                          value={r.expiry}
                          onChange={(e) => set(i, { expiry: e.target.value })}
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="ep-field" htmlFor={`${id}-${String(i)}-q`}>
                    <span className="ep-field__label">Quantity ({unit})</span>
                    <input
                      id={`${id}-${String(i)}-q`}
                      className="ep-input"
                      inputMode="decimal"
                      value={r.qty}
                      onChange={(e) => set(i, { qty: e.target.value })}
                    />
                  </label>
                  <label className="ep-field" htmlFor={`${id}-${String(i)}-r`}>
                    <span className="ep-field__label">Rate per {unit} (₹)</span>
                    <input
                      id={`${id}-${String(i)}-r`}
                      className="ep-input"
                      inputMode="decimal"
                      value={r.rate}
                      onChange={(e) => set(i, { rate: e.target.value })}
                    />
                  </label>
                  {batch && rows.length > 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                    >
                      Remove this batch
                    </Button>
                  ) : null}
                </fieldset>
              ))}
              {batch ? (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setRows((cur) => [...cur, { qty: '', rate: '', batch: '', expiry: '' }])
                    }
                  >
                    Add a batch
                  </Button>
                </div>
              ) : null}
              <p className="ep-field__help" style={{ margin: 0 }}>
                Value:{' '}
                <strong>
                  ₹
                  {total.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
                {Number(rows[0]?.rate) === 0 ? ' — a ₹0 rate leaves the stock with no value' : ''}
              </p>
            </div>
          ) : null}
          <label className="ep-field" htmlFor={`${id}-why`} style={{ marginTop: 'var(--sp-3)' }}>
            <span className="ep-field__label" data-required="true">
              Why
            </span>
            <textarea
              id={`${id}-why`}
              className="ep-input"
              rows={2}
              maxLength={300}
              value={reason}
              placeholder={
                mode === 'change'
                  ? 'e.g. the rate was typed per box, not per piece'
                  : 'e.g. posted to the wrong store'
              }
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error ? (
            <p className="ep-field__error" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
