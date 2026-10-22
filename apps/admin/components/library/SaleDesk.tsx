'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { BorrowerPicker } from './desk/DeskParts';
import type { DeskBorrower } from '@/lib/library-desk';
import { rupees, type SaleBook } from '@/lib/library-sales';
import { saleBook, sellBooks } from '@/lib/library-sales-actions';

type Line = {
  accessionNo: string;
  title: string;
  status: string;
  bought: number | null;
  price: string;
};
const STATUS: Record<string, string> = {
  available: 'On the shelf',
  damaged: 'Damaged',
  withdrawn: 'Withdrawn',
};

/**
 * The sale desk (docs/design/36-library.md, "Library reports", part 4): the buyer (a pupil or staff member
 * found as at the circulation desk, or someone outside by name), the books scanned one after another with
 * the price of each, then sold together: a misc fee on the pupil or staff member, or a receipt for
 * someone outside paid now.
 */
export function SaleDesk({ today }: { today: string }) {
  const router = useRouter();
  const [outside, setOutside] = useState(false);
  const [person, setPerson] = useState<DeskBorrower | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [no, setNo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'bank'>('cash');
  const [reference, setReference] = useState('');
  const [soldOn, setSoldOn] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** what a scan said: shown by the scan box */
  const [scanError, setScanError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scan = useRef<HTMLInputElement>(null);
  const total = lines.reduce((n, l) => n + (Number(l.price) || 0), 0);

  const add = () =>
    start(async () => {
      const typed = no.trim();
      if (!typed) return;
      const r = await saleBook(typed);
      if (!r.ok) return setScanError(r.error);
      const b: SaleBook = r.data;
      if (!b.copy || !b.canSell) return setScanError(`${typed}: ${b.problem ?? 'No such book'}`);
      if (lines.some((l) => l.accessionNo === b.copy!.accessionNo))
        return setScanError(`${b.copy.accessionNo} is in the sale already`);
      setScanError(null);
      setLines((ls) => [
        ...ls,
        {
          accessionNo: b.copy!.accessionNo,
          title: b.copy!.title,
          status: b.copy!.status,
          bought: b.copy!.price,
          price: '',
        },
      ]);
      setNo('');
      setTimeout(() => scan.current?.focus(), 0);
    });

  const sell = () =>
    start(async () => {
      if (!outside && !person) return setError('Find the pupil or staff member first');
      if (outside && name.trim().length < 2) return setError('Name the buyer');
      if (outside && mobile && !/^[6-9]\d{9}$/.test(mobile))
        return setError('The mobile is a 10-digit number');
      if (!lines.length) return setError('Scan the books to sell');
      const bad = lines.find((l) => l.price === '' || !(Number(l.price) >= 0));
      if (bad) return setError(`Give the price of ${bad.accessionNo}`);
      const r = await sellBooks({
        buyerKind: outside ? 'other' : person!.kind,
        buyerId: outside ? undefined : person!.id,
        buyerName: outside ? name.trim() : undefined,
        buyerMobile: outside && mobile ? mobile : undefined,
        books: lines.map((l) => ({ accessionNo: l.accessionNo, price: Number(l.price) })),
        soldOn: soldOn || undefined,
        mode: outside && total > 0 ? mode : undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (!r.ok) return setError(r.error);
      router.push(`/library/sales/${r.data.id}?sold=1`);
    });

  return (
    <div className="ep-sale">
      <section className="ep-card" aria-labelledby="sd-buyer-h">
        <h2 id="sd-buyer-h" className="ep-card__title">
          1. The buyer
        </h2>
        <div className="ep-tabs" style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="ep-tabs__list" role="radiogroup" aria-label="The buyer is">
            {(
              [
                [false, 'A pupil or staff member'],
                [true, 'Someone outside the school'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={outside === v}
                className="ep-tabs__tab"
                onClick={() => {
                  setOutside(v);
                  setError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {outside ? (
          <div className="ep-dlog__filters">
            <label className="ep-field ep-dlog__search" htmlFor="sd-name" style={{ margin: 0 }}>
              <span className="ep-field__label">Name *</span>
              <input
                id="sd-name"
                className="ep-input"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="ep-field" htmlFor="sd-mobile" style={{ margin: 0 }}>
              <span className="ep-field__label">Mobile</span>
              <input
                id="sd-mobile"
                className="ep-input"
                inputMode="numeric"
                value={mobile}
                maxLength={10}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              />
            </label>
          </div>
        ) : (
          <>
            <BorrowerPicker id="sd-person" onPick={setPerson} autoFocus={false} />
            {person ? (
              <p
                className="ep-alert ep-alert--info"
                role="status"
                style={{ marginTop: 'var(--sp-2)' }}
              >
                {person.name} · {person.kind === 'student' ? 'Pupil' : 'Staff'} {person.ref}
                {person.place ? ` · ${person.place}` : ''}. The sale is announced to them as a misc
                fee, paid at the fees counter.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="ep-card" aria-labelledby="sd-books-h">
        <h2 id="sd-books-h" className="ep-card__title">
          2. The books · {lines.length}
        </h2>
        <form
          className="ep-desk__scan"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="ep-field" htmlFor="sd-no">
            <span className="ep-field__label">Book no. (scan or type, then Enter)</span>
            <input
              id="sd-no"
              ref={scan}
              className="ep-input"
              value={no}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => setNo(e.target.value)}
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary" disabled={pending}>
            Add
          </button>
        </form>
        {scanError ? (
          <p
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginTop: 'var(--sp-2)' }}
          >
            {scanError}
          </p>
        ) : (
          <p className="ep-field__help">Books on the shelf, damaged or withdrawn can be sold.</p>
        )}
        {lines.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Books in the sale">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">Now</th>
                  <th scope="col" className="is-numeric">
                    Bought for
                  </th>
                  <th scope="col">Sell for (₹) *</th>
                  <th scope="col">
                    <span className="ep-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.accessionNo}>
                    <td>
                      {l.title}
                      <div className="ep-field__help">{l.accessionNo}</div>
                    </td>
                    <td>{STATUS[l.status] ?? l.status}</td>
                    <td className="is-numeric">{l.bought !== null ? rupees(l.bought) : '—'}</td>
                    <td>
                      <input
                        className="ep-input ep-sale__price"
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={`Price of ${l.accessionNo}`}
                        value={l.price}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)),
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        aria-label={`Take ${l.accessionNo} out of the sale`}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>
                    Total
                  </th>
                  <td>
                    <strong>{rupees(total)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>

      <section className="ep-card" aria-labelledby="sd-pay-h">
        <h2 id="sd-pay-h" className="ep-card__title">
          3. {outside ? 'Payment' : 'The sale'}
        </h2>
        <div className="ep-dlog__filters">
          {outside && total > 0 ? (
            <label className="ep-field" htmlFor="sd-mode" style={{ margin: 0 }}>
              <span className="ep-field__label">Paid by *</span>
              <select
                id="sd-mode"
                className="ep-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank transfer</option>
              </select>
            </label>
          ) : null}
          {outside ? (
            <label className="ep-field" htmlFor="sd-ref" style={{ margin: 0 }}>
              <span className="ep-field__label">Reference</span>
              <input
                id="sd-ref"
                className="ep-input"
                value={reference}
                maxLength={80}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          ) : null}
          <label className="ep-field" htmlFor="sd-on" style={{ margin: 0 }}>
            <span className="ep-field__label">Sold on</span>
            <input
              id="sd-on"
              type="date"
              className="ep-input"
              value={soldOn}
              max={today}
              onChange={(e) => setSoldOn(e.target.value)}
            />
          </label>
          <label className="ep-field ep-dlog__search" htmlFor="sd-note" style={{ margin: 0 }}>
            <span className="ep-field__label">Note</span>
            <input
              id="sd-note"
              className="ep-input"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <p className="ep-field__help">
          {outside
            ? 'The buyer pays now; a numbered misc receipt is made for you to print.'
            : 'The total is announced as a misc fee on the pupil (the parent sees it) or the staff member.'}
        </p>
        {error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="ep-btn ep-btn--primary" disabled={pending} onClick={sell}>
          {pending
            ? 'Selling…'
            : `Sell ${String(lines.length)} book${lines.length === 1 ? '' : 's'} for ${rupees(total)}`}
        </button>
      </section>
    </div>
  );
}
