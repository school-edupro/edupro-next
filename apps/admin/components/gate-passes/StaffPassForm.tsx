'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { applyStaffPass } from '@/lib/gate-pass-actions';

interface Item {
  name: string;
  qty: number;
  serialNo: string;
  returnable: boolean;
}
const blankItem = (): Item => ({ name: '', qty: 1, serialNo: '', returnable: true });

/**
 * An employee's own gate pass: RGP (going out on school work and coming back) or NRGP (not coming back
 * today), with the equipment carried out item by item. It goes for approval; the gate marks out and in.
 */
export function StaffPassForm({ today }: { today: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<'rgp' | 'nrgp'>('rgp');
  const [onDate, setOnDate] = useState(today);
  const [atTime, setAtTime] = useState('');
  const [returnTime, setReturnTime] = useState('');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const setItem = (i: number, patch: Partial<Item>) =>
    setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (category === 'rgp' && !returnTime) return setMsg('Say by when you will be back.');
    if (items.some((i) => i.name.trim().length < 2))
      return setMsg('Give each item a name, or remove the empty row.');
    start(async () => {
      const r = await applyStaffPass({
        category,
        onDate,
        atTime,
        returnTime: category === 'rgp' ? returnTime : undefined,
        reason,
        destination: destination || undefined,
        items: items.map((i) => ({
          name: i.name.trim(),
          qty: i.qty,
          serialNo: i.serialNo.trim() || undefined,
          returnable: i.returnable,
        })),
      });
      if (!r.ok) return setMsg(r.error);
      router.push(`/engagement/gate-passes/${r.id}?ok=requested`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="ep-hd__form">
      <fieldset className="ep-slots">
        <legend className="ep-field__label">Type of pass</legend>
        <div className="ep-slots__grid">
          <label className="ep-slots__slot">
            <input
              type="radio"
              name="category"
              checked={category === 'rgp'}
              onChange={() => setCategory('rgp')}
            />
            <span>RGP · I come back today</span>
          </label>
          <label className="ep-slots__slot">
            <input
              type="radio"
              name="category"
              checked={category === 'nrgp'}
              onChange={() => setCategory('nrgp')}
            />
            <span>NRGP · I do not come back today</span>
          </label>
        </div>
      </fieldset>
      <div className="ep-hd__row">
        <label className="ep-field" htmlFor="sp-date">
          <span className="ep-field__label">Date</span>
          <input
            id="sp-date"
            type="date"
            className="ep-input"
            required
            min={today}
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="sp-out">
          <span className="ep-field__label">Going out at</span>
          <input
            id="sp-out"
            type="time"
            className="ep-input"
            required
            value={atTime}
            onChange={(e) => setAtTime(e.target.value)}
          />
        </label>
        {category === 'rgp' ? (
          <label className="ep-field" htmlFor="sp-back">
            <span className="ep-field__label">Back by</span>
            <input
              id="sp-back"
              type="time"
              className="ep-input"
              required
              value={returnTime}
              onChange={(e) => setReturnTime(e.target.value)}
            />
          </label>
        ) : null}
      </div>
      <div className="ep-hd__row">
        <label className="ep-field" htmlFor="sp-reason">
          <span className="ep-field__label">Purpose</span>
          <input
            id="sp-reason"
            className="ep-input"
            required
            minLength={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="ep-field" htmlFor="sp-dest">
          <span className="ep-field__label">Going to (optional)</span>
          <input
            id="sp-dest"
            className="ep-input"
            maxLength={160}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </label>
      </div>
      <fieldset className="ep-slots">
        <legend className="ep-field__label">Equipment or material taken out of the school</legend>
        {items.length === 0 ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Nothing carried out. Add a row for each item (laptop, projector, files…).
          </p>
        ) : null}
        {items.map((it, i) => (
          <div key={i} className="ep-hd__row">
            <label className="ep-field" htmlFor={`si-name-${String(i)}`}>
              <span className="ep-field__label">Item {i + 1}</span>
              <input
                id={`si-name-${String(i)}`}
                className="ep-input"
                maxLength={120}
                value={it.name}
                onChange={(e) => setItem(i, { name: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor={`si-qty-${String(i)}`}>
              <span className="ep-field__label">Quantity</span>
              <input
                id={`si-qty-${String(i)}`}
                type="number"
                className="ep-input"
                min={1}
                max={9999}
                value={it.qty}
                onChange={(e) => setItem(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label className="ep-field" htmlFor={`si-serial-${String(i)}`}>
              <span className="ep-field__label">Serial / asset no.</span>
              <input
                id={`si-serial-${String(i)}`}
                className="ep-input"
                maxLength={60}
                value={it.serialNo}
                onChange={(e) => setItem(i, { serialNo: e.target.value })}
              />
            </label>
            <label className="ep-check" htmlFor={`si-ret-${String(i)}`}>
              <input
                id={`si-ret-${String(i)}`}
                type="checkbox"
                checked={it.returnable}
                onChange={(e) => setItem(i, { returnable: e.target.checked })}
              />{' '}
              To be brought back
            </label>
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setItems(items.filter((_, n) => n !== i))}
                aria-label={`Remove item ${String(i + 1)}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            onClick={() => setItems([...items, blankItem()])}
            disabled={items.length >= 30}
          >
            Add an item
          </button>
        </div>
      </fieldset>
      {msg ? (
        <p className="ep-field__error" role="alert">
          {msg}
        </p>
      ) : null}
      <div>
        <button type="submit" className="ep-btn ep-btn--primary" disabled={busy}>
          Send for approval
        </button>
      </div>
    </form>
  );
}
