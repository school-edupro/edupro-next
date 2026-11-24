'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Item {
  name: string;
  qty: number;
  serialNo: string;
  returnable: boolean;
}
const blankItem = (): Item => ({ name: '', qty: 1, serialNo: '', returnable: true });

/** What the form sends: the staff gate pass body (`POST /gate-passes/staff`). */
export interface StaffPassInput {
  category: 'rgp' | 'nrgp';
  onDate: string;
  atTime: string;
  returnTime?: string;
  reason: string;
  destination?: string;
  items: Array<{ name: string; qty: number; serialNo?: string; returnable: boolean }>;
}
export type StaffPassResult = { ok: true; id: string } | { ok: false; error: string };

/** The form's words, in the person's language (the page reads them). */
export type StaffPassWords = Record<
  | 'type'
  | 'rgp'
  | 'nrgp'
  | 'date'
  | 'out'
  | 'back'
  | 'purpose'
  | 'goingTo'
  | 'items'
  | 'none'
  | 'item'
  | 'qty'
  | 'serial'
  | 'bringBack'
  | 'remove'
  | 'add'
  | 'send'
  | 'needBack'
  | 'needName',
  string
>;

/**
 * My own gate pass, as the admin website's (0069): RGP (going out on school work and coming back) or NRGP
 * (not coming back today), with the equipment carried out item by item (none to start with, up to 30). It goes for
 * approval; the gate marks out and in.
 */
export function StaffPassForm({
  today,
  words: w,
  apply,
}: {
  today: string;
  words: StaffPassWords;
  apply: (input: StaffPassInput) => Promise<StaffPassResult>;
}) {
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
    if (category === 'rgp' && !returnTime) return setMsg(w.needBack);
    if (items.some((i) => i.name.trim().length < 2)) return setMsg(w.needName);
    start(async () => {
      const r = await apply({
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
      router.push('/gate-passes?ok=requested#mine');
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="ep-hd__form">
      <fieldset className="ep-slots">
        <legend className="ep-field__label">{w.type}</legend>
        <div className="ep-slots__grid">
          <label className="ep-slots__slot">
            <input
              type="radio"
              name="category"
              checked={category === 'rgp'}
              onChange={() => setCategory('rgp')}
            />
            <span>{w.rgp}</span>
          </label>
          <label className="ep-slots__slot">
            <input
              type="radio"
              name="category"
              checked={category === 'nrgp'}
              onChange={() => setCategory('nrgp')}
            />
            <span>{w.nrgp}</span>
          </label>
        </div>
      </fieldset>
      <div className="ep-hd__row">
        <label className="ep-field" htmlFor="sp-date">
          <span className="ep-field__label">{w.date}</span>
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
          <span className="ep-field__label">{w.out}</span>
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
            <span className="ep-field__label">{w.back}</span>
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
          <span className="ep-field__label">{w.purpose}</span>
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
          <span className="ep-field__label">{w.goingTo}</span>
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
        <legend className="ep-field__label">{w.items}</legend>
        {items.length === 0 ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {w.none}
          </p>
        ) : null}
        {items.map((it, i) => (
          <div key={i} className="ep-hd__row">
            <label className="ep-field" htmlFor={`si-name-${String(i)}`}>
              <span className="ep-field__label">
                {w.item} {i + 1}
              </span>
              <input
                id={`si-name-${String(i)}`}
                className="ep-input"
                maxLength={120}
                value={it.name}
                onChange={(e) => setItem(i, { name: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor={`si-qty-${String(i)}`}>
              <span className="ep-field__label">{w.qty}</span>
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
              <span className="ep-field__label">{w.serial}</span>
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
              {w.bringBack}
            </label>
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setItems(items.filter((_, n) => n !== i))}
                aria-label={`${w.remove}: ${w.item} ${String(i + 1)}`}
              >
                {w.remove}
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
            {w.add}
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
          {w.send}
        </button>
      </div>
    </form>
  );
}
