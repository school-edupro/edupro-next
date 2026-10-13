'use client';

import { useState } from 'react';
import type { MiscAnnouncePayload, MiscResult, MiscSheetRow } from '@/lib/misc-fee-actions';
import { EMPTY_AUDIENCE, MiscAudience, type MiscAudienceValue } from './MiscAudience';

type Option = { value: string; label: string };
type Found = { id: string; name: string; admissionNo: string; section: string | null };

/**
 * A misc fee is announced here: its head, name, amount, last date, whether parents must pay it and,
 * for a trip with limited places, the seats; then who it is for. It goes for approval; the message to
 * parents is sent from the fee's page once it is approved.
 */
export function MiscAnnounce({
  heads,
  classes,
  sections,
  announce,
  findPupils,
  readSheet,
}: {
  heads: Option[];
  classes: Option[];
  sections: Option[];
  announce: (p: MiscAnnouncePayload) => Promise<MiscResult<{ id: string; pupils: number }>>;
  findPupils: (q: string) => Promise<MiscResult<Found[]>>;
  readSheet: (base64: string) => Promise<MiscResult<{ rows: MiscSheetRow[]; errors: string[] }>>;
}) {
  const [headText, setHeadText] = useState('');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [lastDate, setLastDate] = useState('');
  const [remark, setRemark] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [limited, setLimited] = useState(false);
  const [seats, setSeats] = useState('');
  const [audience, setAudience] = useState<MiscAudienceValue>(EMPTY_AUDIENCE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const head = heads.find((h) => h.label.toLowerCase() === headText.trim().toLowerCase());
  const chosen =
    audience.classIds.length +
    audience.sectionIds.length +
    audience.studentIds.length +
    audience.rows.length;
  const ready =
    !!head &&
    title.trim().length >= 2 &&
    amount !== '' &&
    Number(amount) >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(lastDate) &&
    chosen > 0 &&
    (!limited || Number(seats) >= 1);

  const submit = async () => {
    if (!ready || !head) return;
    setBusy(true);
    setError('');
    const r = await announce({
      headId: head.value,
      title: title.trim(),
      amount: Number(amount),
      lastDate,
      remark: remark.trim() || undefined,
      mandatory,
      seats: limited ? Number(seats) : undefined,
      ...audience,
    });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    window.location.href = `/fees/misc-fees/${r.data.id}?ok=1&detail=${encodeURIComponent(
      `Announced to ${String(r.data.pupils)} pupil(s): waiting for approval`,
    )}`;
  };

  return (
    <div className="ep-compose">
      <div className="ep-compose__main">
        <section className="ep-card" aria-labelledby="mf-step1">
          <h2 className="ep-card__title" id="mf-step1">
            1. The fee
          </h2>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
            }}
          >
            <label className="ep-field" htmlFor="mf-head" style={{ margin: 0 }}>
              <span className="ep-field__label">Misc fee head</span>
              <input
                id="mf-head"
                className="ep-input"
                list="mf-heads"
                value={headText}
                placeholder="Type to search"
                onChange={(e) => setHeadText(e.target.value)}
              />
              <datalist id="mf-heads">
                {heads.map((h) => (
                  <option key={h.value} value={h.label} />
                ))}
              </datalist>
            </label>
            <label className="ep-field" htmlFor="mf-title" style={{ margin: 0 }}>
              <span className="ep-field__label">Name of the fee</span>
              <input
                id="mf-title"
                className="ep-input"
                value={title}
                maxLength={120}
                placeholder="Jaipur trip, Class X"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="ep-field" htmlFor="mf-amount" style={{ margin: 0 }}>
              <span className="ep-field__label">Amount (₹)</span>
              <input
                id="mf-amount"
                className="ep-input"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="ep-field" htmlFor="mf-last" style={{ margin: 0 }}>
              <span className="ep-field__label">Last date to pay</span>
              <input
                id="mf-last"
                className="ep-input"
                type="date"
                value={lastDate}
                onChange={(e) => setLastDate(e.target.value)}
              />
            </label>
          </div>
          <label className="ep-field" htmlFor="mf-remark">
            <span className="ep-field__label">Remark</span>
            <input
              id="mf-remark"
              className="ep-input"
              value={remark}
              maxLength={300}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">For parents this fee is</legend>
            <label style={{ marginRight: 'var(--sp-4)' }}>
              <input
                type="radio"
                name="mf-mandatory"
                checked={!mandatory}
                onChange={() => setMandatory(false)}
              />{' '}
              Optional: it closes on the last date
            </label>
            <label>
              <input
                type="radio"
                name="mf-mandatory"
                checked={mandatory}
                onChange={() => setMandatory(true)}
              />{' '}
              Mandatory: it stays due after the last date
            </label>
          </fieldset>
          <p style={{ marginBottom: 0 }}>
            <label>
              <input
                type="checkbox"
                checked={limited}
                onChange={(e) => setLimited(e.target.checked)}
              />{' '}
              Limited seats, first come first served
            </label>
          </p>
          {limited ? (
            <label className="ep-field" htmlFor="mf-seats">
              <span className="ep-field__label">Seats</span>
              <input
                id="mf-seats"
                className="ep-input"
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
              <span className="ep-field__help">
                A seat is taken by paying in full, in the order of payment. When the seats are taken
                nobody else can pay; a cancelled or refunded receipt gives the seat back.
              </span>
            </label>
          ) : null}
        </section>
        <section className="ep-card" aria-labelledby="mf-step2">
          <h2 className="ep-card__title" id="mf-step2">
            2. Who it is for
          </h2>
          <MiscAudience
            classes={classes}
            sections={sections}
            value={audience}
            onChange={setAudience}
            findPupils={findPupils}
            readSheet={readSheet}
          />
        </section>
      </div>
      <aside className="ep-compose__sticky">
        <section className="ep-card" aria-labelledby="mf-sum">
          <h2 className="ep-card__title" id="mf-sum">
            Summary
          </h2>
          <p style={{ margin: 0 }}>
            <strong>{title.trim() || 'The fee'}</strong>
            {amount !== '' ? ` · ₹${Number(amount).toLocaleString('en-IN')}` : ''}
          </p>
          <p className="ep-field__help">
            {mandatory ? 'Mandatory' : 'Optional'}
            {limited && seats ? ` · ${seats} seats` : ''}
            {lastDate ? ` · last date ${lastDate.split('-').reverse().join('-')}` : ''}
          </p>
          <p className="ep-field__help">
            {audience.classIds.length} class(es), {audience.sectionIds.length} section(s),{' '}
            {audience.studentIds.length} pupil(s) by name, {audience.rows.length} from the sheet. A
            pupil chosen twice is counted once.
          </p>
          {error ? (
            <p className="ep-field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Sending…' : 'Send for approval'}
            </button>
            <a className="ep-btn ep-btn--ghost" href="/fees/misc-fees">
              Back
            </a>
          </div>
          <p className="ep-field__help">
            Parents see the fee, and can be sent the SMS, WhatsApp or email, once it is approved.
          </p>
        </section>
      </aside>
    </div>
  );
}
