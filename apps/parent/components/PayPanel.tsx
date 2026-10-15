'use client';
import { Badge, Button } from '@edupro/ui';
import { useState } from 'react';

export interface PayRow {
  key: string;
  label: string;
  dueOn: string;
  net: string;
  paid: string;
  balance: string;
  lateFee: string;
  status: 'paid' | 'overdue' | 'due' | 'upcoming';
  /** false: the class keeps this instalment off online payment */
  online: boolean;
}

export interface PayGateway {
  id: string;
  label: string;
  chargePercent: string;
  chargeFlat: string;
}

/** The words of the panel, in the parent's language (the page translates them). */
export interface PayWords {
  instalment: string;
  dueOn: string;
  fee: string;
  paid: string;
  toPay: string;
  lateFee: string;
  status: string;
  statuses: Record<PayRow['status'], string>;
  counter: string;
  oldestFirst: string;
  payThrough: string;
  charge: string;
  noCharge: string;
  total: string;
  pay: string;
  nothingTicked: string;
  noGateway: string;
  selectRow: string;
}

const money = (v: number) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('-');
/** As the API works it out (gateways.service chargeOn), so the total shown is the total charged. */
const chargeOn = (amount: number, g: PayGateway) =>
  Math.round(((amount * Number(g.chargePercent)) / 100) * 100 + Number(g.chargeFlat) * 100) / 100;
const chargeText = (g: PayGateway) =>
  [
    Number(g.chargeFlat) > 0 ? `₹${money(Number(g.chargeFlat))}` : '',
    Number(g.chargePercent) > 0 ? `${g.chargePercent}%` : '',
  ]
    .filter(Boolean)
    .join(' + ');
const tone = (s: PayRow['status']) =>
  s === 'paid' ? 'success' : s === 'overdue' ? 'danger' : s === 'due' ? 'warning' : 'neutral';

/**
 * One fee (school or hostel) of one pupil: its instalments with a tick box each, the gateways the school
 * takes it through, and the total with the convenience charge. Instalments are paid the oldest first: a
 * tick takes the earlier ones with it and clearing one clears the later ones. Everything due today is
 * ticked to start with.
 */
export function PayPanel({
  studentId,
  ledger,
  rows,
  payable,
  gateways,
  canPay,
  words,
}: {
  studentId: string;
  ledger: 'school' | 'hostel';
  rows: PayRow[];
  /** the ledger's own payable figure: paying every instalment pays exactly this */
  payable: string;
  gateways: PayGateway[];
  canPay: boolean;
  words: PayWords;
}) {
  const due = (r: PayRow) => Number(r.balance) + Number(r.lateFee);
  const open = rows.filter((r) => r.online && due(r) > 0);
  const [upTo, setUpTo] = useState(() => {
    let last = -1;
    open.forEach((r, i) => {
      if (r.status === 'overdue' || r.status === 'due') last = i;
    });
    return last;
  });
  const [gw, setGw] = useState(gateways[0]?.id ?? '');
  const fee =
    upTo < 0
      ? 0
      : upTo === open.length - 1 && Number(payable) > 0
        ? Number(payable)
        : Math.round(open.slice(0, upTo + 1).reduce((a, r) => a + due(r), 0) * 100) / 100;
  const chosen = gateways.find((g) => g.id === gw);
  const charge = chosen && fee > 0 ? chargeOn(fee, chosen) : 0;
  const tick = (i: number, on: boolean) => setUpTo(on ? i : i - 1);
  const payNow = canPay && open.length > 0;

  // one form round the whole panel, so the pay bar stays in view while the instalments are ticked
  const Wrap = payNow ? 'form' : 'div';
  return (
    <Wrap className="fp-pay" {...(payNow ? { method: 'post', action: '/fees/pay' } : {})}>
      {payNow ? (
        <>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="ledger" value={ledger} />
          <input type="hidden" name="amount" value={fee.toFixed(2)} />
          <p className="ep-field__help">{words.oldestFirst}</p>
        </>
      ) : null}
      <ul className="fp-pay__list" aria-label={words.instalment}>
        {rows.map((r) => {
          const i = open.indexOf(r);
          const ticked = i >= 0 && i <= upTo;
          const id = `pay-${ledger}-${r.key}`;
          return (
            <li key={r.key} className={`fp-pay__row${ticked ? ' fp-pay__row--on' : ''}`}>
              {payNow && i >= 0 ? (
                <input
                  id={id}
                  type="checkbox"
                  className="fp-pay__tick"
                  checked={ticked}
                  onChange={(e) => tick(i, e.target.checked)}
                  aria-label={`${words.selectRow} ${r.label}`}
                />
              ) : (
                <span className="fp-pay__tick" aria-hidden="true" />
              )}
              <label htmlFor={payNow && i >= 0 ? id : undefined} className="fp-pay__what">
                <strong>{r.label}</strong>
                <span className="ep-field__help">
                  {words.dueOn} {dmy(r.dueOn)} · {words.fee} ₹{money(Number(r.net))}
                  {Number(r.paid) > 0 ? ` · ${words.paid} ₹${money(Number(r.paid))}` : ''}
                  {Number(r.lateFee) > 0 ? ` · ${words.lateFee} ₹${money(Number(r.lateFee))}` : ''}
                </span>
                {!r.online && due(r) > 0 ? (
                  <span className="ep-field__help">{words.counter}</span>
                ) : null}
              </label>
              <span className="fp-pay__amt">
                <Badge tone={tone(r.status)}>{words.statuses[r.status]}</Badge>
                {due(r) > 0 ? <strong>₹{money(due(r))}</strong> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {payNow ? (
        <>
          {gateways.length === 0 ? (
            <p className="ep-alert ep-alert--info">{words.noGateway}</p>
          ) : (
            <fieldset className="fp-pay__gws">
              <legend className="ep-field__label">{words.payThrough}</legend>
              {gateways.map((g) => (
                <label key={g.id} className={`fp-gw${gw === g.id ? ' fp-gw--on' : ''}`}>
                  <input
                    type="radio"
                    name="gatewayId"
                    value={g.id}
                    checked={gw === g.id}
                    onChange={() => setGw(g.id)}
                  />
                  <span>
                    <strong>{g.label}</strong>
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {chargeText(g) ? `${words.charge} ${chargeText(g)}` : words.noCharge}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="fp-pay__bar">
            <div>
              <div className="ep-kicker">{words.total}</div>
              <div className="fp-pay__total" aria-live="polite">
                ₹{money(fee + charge)}
              </div>
              {charge > 0 ? (
                <span className="ep-field__help">
                  ₹{money(fee)} + {words.charge} ₹{money(charge)}
                </span>
              ) : null}
            </div>
            <Button type="submit" disabled={fee <= 0 || !chosen}>
              {fee > 0 ? `${words.pay} ₹${money(fee + charge)}` : words.nothingTicked}
            </Button>
          </div>
        </>
      ) : null}
    </Wrap>
  );
}
