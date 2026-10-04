'use client';
import { useMemo, useState } from 'react';

type Service = 'pick' | 'drop' | 'both';
interface Stop {
  id: string;
  name: string;
  pickupTime: string | null;
  dropTime: string | null;
  slab: string | null;
  amount: number | null;
}
interface Route {
  id: string;
  code: string;
  name: string;
  vehicle: string | null;
  stops: Stop[];
}
export interface RideFormProps {
  /** The server action the form posts to. */
  action: (fd: FormData) => void | Promise<void>;
  studentId: string;
  returnTo: string;
  routes: Route[];
  months: string[];
  thisMonth: string;
  settings: { oneWayPercent: number; twoStopRule: 'higher' | 'pick' | 'sum' };
  /** The pupil rides now or is about to: the request is a change or a withdrawal. */
  riding: boolean;
  submitLabel?: string;
}

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const SERVICES: Array<[Service, string, string]> = [
  ['both', 'Pick and drop', 'Home to school and back'],
  ['pick', 'Pick only', 'Home to school'],
  ['drop', 'Drop only', 'School to home'],
];

/**
 * How a pupil rides: the service, then route → stoppage (the stoppage brings its fee slab), and the
 * months. The charge shown follows the school's rule; the server works it out again when the request
 * is saved.
 */
export function RideForm(p: RideFormProps) {
  const next = p.months.find((m) => m > p.thisMonth) ?? p.months.find((m) => m >= p.thisMonth);
  const [kind, setKind] = useState<'join' | 'change' | 'leave'>(p.riding ? 'change' : 'join');
  const [service, setService] = useState<Service>('both');
  const [pickRoute, setPickRoute] = useState('');
  const [pickStop, setPickStop] = useState('');
  const [otherDrop, setOtherDrop] = useState(false);
  const [dropRoute, setDropRoute] = useState('');
  const [dropStop, setDropStop] = useState('');
  const [from, setFrom] = useState(next ?? p.months[0] ?? '');
  const [to, setTo] = useState(p.months[p.months.length - 1] ?? '');

  const stopsOf = (routeId: string) => p.routes.find((r) => r.id === routeId)?.stops ?? [];
  const needPick = kind !== 'leave' && service !== 'drop';
  const needDrop = kind !== 'leave' && (service === 'drop' || (service === 'both' && otherDrop));
  const pick = needPick ? (stopsOf(pickRoute).find((s) => s.id === pickStop) ?? null) : null;
  const drop = needDrop
    ? (stopsOf(dropRoute).find((s) => s.id === dropStop) ?? null)
    : service === 'both'
      ? pick
      : null;

  const quote = useMemo(() => {
    const oneWay = (a: number) => Math.round(a * p.settings.oneWayPercent) / 100;
    const missing = [pick, drop].find((s) => s && s.amount === null);
    if (missing) return { error: `The stoppage “${missing.name}” has no fee slab yet.` };
    if (service === 'pick' && pick)
      return {
        amount: oneWay(pick.amount!),
        slab: pick.slab,
        rule: `Pick only: ${String(p.settings.oneWayPercent)}% of the slab`,
      };
    if (service === 'drop' && drop)
      return {
        amount: oneWay(drop.amount!),
        slab: drop.slab,
        rule: `Drop only: ${String(p.settings.oneWayPercent)}% of the slab`,
      };
    if (service === 'both' && pick && drop) {
      if (pick.id === drop.id || pick.amount === drop.amount)
        return { amount: pick.amount!, slab: pick.slab, rule: 'The slab of the stoppage' };
      if (p.settings.twoStopRule === 'pick')
        return { amount: pick.amount!, slab: pick.slab, rule: 'The slab of the pick stoppage' };
      const higher = pick.amount! >= drop.amount! ? pick : drop;
      if (p.settings.twoStopRule === 'sum')
        return {
          amount: oneWay(pick.amount!) + oneWay(drop.amount!),
          slab: higher.slab,
          rule: `${String(p.settings.oneWayPercent)}% of each slab, added`,
        };
      return { amount: higher.amount!, slab: higher.slab, rule: 'The higher of the two slabs' };
    }
    return null;
  }, [pick, drop, service, p.settings]);

  const stopLabel = (s: Stop, side: 'pick' | 'drop') =>
    [
      s.name,
      side === 'pick' ? s.pickupTime : s.dropTime,
      s.slab ? `${s.slab}${s.amount !== null ? ` ${rupees(s.amount)}` : ''}` : 'no slab',
    ]
      .filter(Boolean)
      .join(' · ');
  const side = (
    which: 'pick' | 'drop',
    route: string,
    setRoute: (v: string) => void,
    stop: string,
    setStop: (v: string) => void,
  ) => (
    <div className="ep-hd__row">
      <label className="ep-field" htmlFor={`rf-${which}-route`}>
        <span className="ep-field__label">{which === 'pick' ? 'Pick route' : 'Drop route'}</span>
        <select
          id={`rf-${which}-route`}
          name={`${which}RouteId`}
          className="ep-select"
          required
          value={route}
          onChange={(e) => {
            setRoute(e.target.value);
            setStop('');
          }}
        >
          <option value="">Choose the route</option>
          {p.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name}
              {r.vehicle ? ` (${r.vehicle})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field" htmlFor={`rf-${which}-stop`}>
        <span className="ep-field__label">
          {which === 'pick' ? 'Pick stoppage' : 'Drop stoppage'}
        </span>
        <select
          id={`rf-${which}-stop`}
          name={`${which}StopId`}
          className="ep-select"
          required
          key={route}
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          disabled={!route}
        >
          <option value="">{route ? 'Choose the stoppage' : 'Choose the route first'}</option>
          {stopsOf(route).map((s) => (
            <option key={s.id} value={s.id}>
              {stopLabel(s, which)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <form action={p.action} className="ep-hd__form">
      <input type="hidden" name="studentId" value={p.studentId} />
      <input type="hidden" name="returnTo" value={p.returnTo} />
      <input type="hidden" name="kind" value={kind} />
      {p.riding ? (
        <fieldset className="ep-slots">
          <legend className="ep-field__label">What do you want to do?</legend>
          <div className="ep-slots__grid">
            <label className="ep-slots__slot">
              <input
                type="radio"
                name="kindPick"
                checked={kind === 'change'}
                onChange={() => setKind('change')}
              />
              <span>Change the route, stoppage or service</span>
            </label>
            <label className="ep-slots__slot">
              <input
                type="radio"
                name="kindPick"
                checked={kind === 'leave'}
                onChange={() => setKind('leave')}
              />
              <span>Stop the transport (withdrawal)</span>
            </label>
          </div>
        </fieldset>
      ) : null}
      {kind !== 'leave' ? (
        <>
          <fieldset className="ep-slots">
            <legend className="ep-field__label">Service</legend>
            <div className="ep-slots__grid">
              {SERVICES.map(([value, label, help]) => (
                <label key={value} className="ep-slots__slot">
                  <input
                    type="radio"
                    name="service"
                    value={value}
                    checked={service === value}
                    onChange={() => setService(value)}
                  />
                  <span>
                    {label} <small>({help})</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {needPick ? side('pick', pickRoute, setPickRoute, pickStop, setPickStop) : null}
          {service === 'both' ? (
            <label className="ep-check" htmlFor="rf-other">
              <input
                id="rf-other"
                type="checkbox"
                checked={otherDrop}
                onChange={(e) => setOtherDrop(e.target.checked)}
              />{' '}
              The drop is at a different stoppage or route
            </label>
          ) : null}
          {needDrop ? side('drop', dropRoute, setDropRoute, dropStop, setDropStop) : null}
        </>
      ) : null}
      <div className="ep-hd__row">
        <label className="ep-field" htmlFor="rf-from">
          <span className="ep-field__label">
            {kind === 'leave' ? 'No transport from (month)' : 'From month'}
          </span>
          <select
            id="rf-from"
            name="fromMonth"
            className="ep-select"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (to < e.target.value) setTo(e.target.value);
            }}
          >
            {p.months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        {kind !== 'leave' ? (
          <label className="ep-field" htmlFor="rf-to">
            <span className="ep-field__label">To month</span>
            <select
              id="rf-to"
              name="toMonth"
              className="ep-select"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {p.months
                .filter((m) => m >= from)
                .map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {kind === 'leave' ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            The bus, its fee and the live bus position stay until the month before{' '}
            {from ? monthLabel(from) : 'the month chosen'}; no transport fee is charged from that
            month.
          </p>
        ) : quote && 'error' in quote ? (
          <p className="ep-field__error" style={{ margin: 0 }}>
            {quote.error} Please ask the transport office.
          </p>
        ) : quote ? (
          <p style={{ margin: 0 }}>
            Slab <strong>{quote.slab ?? '—'}</strong> · monthly charge{' '}
            <strong>{rupees(quote.amount)}</strong>
            <span className="ep-field__help"> · {quote.rule}</span>
          </p>
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Choose the route and the stoppage to see the slab and the monthly charge.
          </p>
        )}
      </div>
      <label className="ep-field" htmlFor="rf-note">
        <span className="ep-field__label">Note (optional)</span>
        <input id="rf-note" name="note" className="ep-input" maxLength={300} />
      </label>
      <div>
        <button type="submit" className="ep-btn ep-btn--primary">
          {p.submitLabel ?? 'Send for approval'}
        </button>
      </div>
    </form>
  );
}
