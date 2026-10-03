'use client';
import { useState, useTransition } from 'react';
import { lookupVisitor, registerVisitor } from '@/lib/visitor-actions';
import type { VisitorOptions } from '@/lib/visitors';
import { LiveCamera } from './LiveCamera';

interface Draft {
  mobile: string;
  visitorName: string;
  visitorType: string;
  organisation: string;
  email: string;
  partySize: number;
  idProofKind: string;
  idProofLast4: string;
  vehicleNo: string;
  equipment: string;
  hostId: string;
  toMeet: string;
  purpose: string;
  gate: string;
  badgeNo: string;
  photo: string;
}

/**
 * The gate registers a walk-in visitor. The mobile number comes first: a visitor who came before has the
 * details filled in from the last visit. Then who they are, what they carry, whom they meet and a live
 * photo. Saving lets the visitor in, mails the person to be met and offers the card to print.
 */
export function VisitorForm({ options }: { options: VisitorOptions }) {
  const blank = (): Draft => ({
    mobile: '',
    visitorName: '',
    visitorType: options.types[0] ?? '',
    organisation: '',
    email: '',
    partySize: 1,
    idProofKind: '',
    idProofLast4: '',
    vehicleNo: '',
    equipment: '',
    hostId: options.hosts[0]?.id ?? '',
    toMeet: '',
    purpose: '',
    gate: options.gates[0] ?? '',
    badgeNo: '',
    photo: '',
  });
  const [d, setD] = useState<Draft>(blank);
  const [found, setFound] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<{ id: string; number: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const find = () =>
    start(async () => {
      setMsg(null);
      const r = await lookupVisitor(d.mobile);
      if ('error' in r) return setFound(r.error);
      if (!r.last) return setFound('First visit: no earlier details for this number.');
      const l = r.last;
      setD((x) => ({
        ...x,
        visitorName: l.visitorName,
        organisation: l.organisation ?? '',
        visitorType:
          l.visitorType && options.types.includes(l.visitorType) ? l.visitorType : x.visitorType,
        email: l.email ?? '',
        idProofKind:
          l.idProofKind && options.idProofKinds.includes(l.idProofKind) ? l.idProofKind : '',
        idProofLast4: l.idProofLast4 ?? '',
        vehicleNo: l.vehicleNo ?? '',
        hostId: l.hostId && options.hosts.some((h) => h.id === l.hostId) ? l.hostId : x.hostId,
      }));
      setFound(
        `${l.stillInside ? 'This visitor is still marked inside. ' : ''}Came ${String(r.visits)} time${r.visits === 1 ? '' : 's'} before; the details are filled in. Check them and take a new photo.`,
      );
    });

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await registerVisitor({
        visitorName: d.visitorName,
        mobile: d.mobile || undefined,
        visitorType: d.visitorType || undefined,
        organisation: d.organisation || undefined,
        email: d.email || undefined,
        partySize: d.partySize,
        idProofKind: d.idProofKind || undefined,
        idProofLast4: d.idProofLast4 || undefined,
        vehicleNo: d.vehicleNo || undefined,
        equipment: d.equipment || undefined,
        hostId: d.hostId || undefined,
        toMeet: d.hostId ? undefined : d.toMeet || undefined,
        purpose: d.purpose,
        gate: d.gate || undefined,
        badgeNo: d.badgeNo || undefined,
        photo: d.photo || undefined,
      });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setDone({ id: r.id, number: r.number, name: d.visitorName });
      setD(blank());
      setFound(null);
    });

  const field = (
    k:
      | 'visitorName'
      | 'organisation'
      | 'email'
      | 'idProofLast4'
      | 'vehicleNo'
      | 'equipment'
      | 'toMeet'
      | 'purpose'
      | 'badgeNo',
    label: string,
    extra: { maxLength?: number; type?: string; list?: string; help?: string } = {},
  ) => (
    <label className="ep-field" htmlFor={`vf-${k}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`vf-${k}`}
        className="ep-input"
        type={extra.type ?? 'text'}
        maxLength={extra.maxLength ?? 120}
        list={extra.list}
        value={d[k]}
        onChange={(e) => set(k, e.target.value)}
      />
      {extra.help ? <span className="ep-field__help">{extra.help}</span> : null}
    </label>
  );
  const select = (
    k: 'visitorType' | 'idProofKind' | 'hostId' | 'gate',
    label: string,
    items: Array<{ value: string; label: string }>,
  ) => (
    <label className="ep-field" htmlFor={`vf-${k}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`vf-${k}`}
        className="ep-select"
        value={d[k]}
        onChange={(e) => set(k, e.target.value)}
      >
        {items.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const ready =
    d.visitorName.trim().length >= 2 &&
    d.purpose.trim().length >= 3 &&
    (d.hostId !== '' || d.toMeet.trim().length >= 2) &&
    (d.mobile === '' || /^[6-9]\d{9}$/.test(d.mobile));

  return (
    <div className="ep-hd__form">
      {done ? (
        <div className="ep-alert ep-alert--success ep-save" role="status">
          <span>
            {done.name} is let in. Pass {done.number}. The person to be met has been told by mail.
          </span>
          <a
            className="ep-btn ep-btn--primary ep-btn--sm"
            href={`/engagement/visitors/${done.id}/card`}
            target="_blank"
            rel="noreferrer"
          >
            Print the visitor card
          </a>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/engagement/visitors">
            Back to the register
          </a>
        </div>
      ) : null}
      <section className="ep-card" aria-labelledby="vf-1">
        <h2 id="vf-1" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          1. Mobile number
        </h2>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="vf-mobile">
            <span className="ep-field__label">Visitor’s mobile (10 digits)</span>
            <input
              id="vf-mobile"
              className="ep-input"
              inputMode="numeric"
              maxLength={10}
              autoComplete="off"
              value={d.mobile}
              onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </label>
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={pending || d.mobile.length !== 10}
              onClick={find}
            >
              Find earlier visits
            </button>
          </div>
        </div>
        {found ? (
          <p className="ep-field__help" role="status">
            {found}
          </p>
        ) : null}
      </section>
      <section className="ep-card" aria-labelledby="vf-2">
        <h2 id="vf-2" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          2. The visitor
        </h2>
        <div className="ep-hd__row">
          {field('visitorName', 'Name')}
          {select(
            'visitorType',
            'Type of visitor',
            options.types.map((x) => ({ value: x, label: x })),
          )}
          {field('organisation', 'Company or coming from')}
          <label className="ep-field" htmlFor="vf-party">
            <span className="ep-field__label">People (with the visitor)</span>
            <input
              id="vf-party"
              type="number"
              className="ep-input"
              min={1}
              max={50}
              value={d.partySize}
              onChange={(e) => set('partySize', Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
        <div className="ep-hd__row">
          {select('idProofKind', 'ID proof shown', [
            { value: '', label: 'None' },
            ...options.idProofKinds.map((x) => ({ value: x, label: x })),
          ])}
          {field('idProofLast4', 'Last 4 characters of the ID', {
            maxLength: 4,
            help: 'Only these 4 are kept, never the full number.',
          })}
          {field('vehicleNo', 'Vehicle number', { maxLength: 20 })}
          {field('email', 'Email (optional)', { type: 'email', maxLength: 200 })}
        </div>
        {field('equipment', 'Equipment or material carried in', {
          maxLength: 300,
          help: 'For example: laptop, tool kit, 2 cartons. Check it again when the visitor leaves.',
        })}
        <LiveCamera value={d.photo} onChange={(v) => set('photo', v)} />
      </section>
      <section className="ep-card" aria-labelledby="vf-3">
        <h2 id="vf-3" className="ep-cdash__h3" style={{ marginTop: 0 }}>
          3. The visit
        </h2>
        <div className="ep-hd__row">
          {select('hostId', 'To meet', [
            ...options.hosts.map((h) => ({
              value: h.id,
              label: `${h.name}${h.person ? ` · ${h.person}` : ''}`,
            })),
            { value: '', label: 'Someone else (type the name)' },
          ])}
          {d.hostId === '' ? field('toMeet', 'Name of the person or office') : null}
          {field('purpose', 'Purpose', { maxLength: 300, list: 'vf-purposes' })}
          {select(
            'gate',
            'Gate',
            options.gates.map((x) => ({ value: x, label: x })),
          )}
          {field('badgeNo', 'Visitor badge no. (optional)', { maxLength: 20 })}
        </div>
        <datalist id="vf-purposes">
          {options.purposes.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="ep-save">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !ready}
            onClick={save}
          >
            Let the visitor in
          </button>
          {msg ? (
            <span className="ep-alert ep-alert--danger" role="alert">
              {msg.text}
            </span>
          ) : (
            <span className="ep-field__help">The person to be met is told by mail.</span>
          )}
        </div>
      </section>
    </div>
  );
}
