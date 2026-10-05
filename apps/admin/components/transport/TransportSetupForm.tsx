'use client';
import { useState, useTransition } from 'react';
import { saveTransportSetup } from '@/lib/transport-desk-actions';
import type { TransportLevel, TransportSetup } from '@/lib/transport-desk';

type Source = 'parent' | 'office';
const KINDS: Array<[TransportLevel['kind'], string]> = [
  ['route_incharge', 'The transport in-charge of the route (named below)'],
  ['role', 'Everyone with a role'],
  ['designation', 'Everyone with a designation'],
  ['employee', 'One employee'],
];

/**
 * Transport settings: how a one-way service and two different stoppages are charged, whether families
 * may ask from the portal, and who approves a request (one chain for a family's request, one for a
 * request the transport office makes).
 */
export function TransportSetupForm({ setup }: { setup: TransportSetup }) {
  const [s, setS] = useState(setup.settings);
  const [levels, setLevels] = useState<TransportLevel[]>(setup.levels);
  // who is in charge: '' = of the whole school, else of one route
  const [incharges, setIncharges] = useState(
    setup.incharges.map((i) => ({ routeId: i.routeId ?? '', employeeId: i.employeeId })),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const of = (a: Source) => levels.filter((l) => l.source === a);
  const put = (a: Source, next: TransportLevel[]) =>
    setLevels([...levels.filter((l) => l.source !== a), ...next]);
  const patch = (a: Source, i: number, p: Partial<TransportLevel>) =>
    put(
      a,
      of(a).map((l, n) => (n === i ? { ...l, ...p } : l)),
    );
  const move = (a: Source, i: number, by: number) => {
    const list = [...of(a)];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    put(a, list);
  };

  const save = () =>
    start(async () => {
      setMsg(null);
      for (const a of ['parent', 'office'] as const) {
        const active = of(a).filter((l) => l.active);
        if (!active.length)
          return setMsg({
            ok: false,
            text: `Keep at least one approval level for a request ${a === 'parent' ? 'from a family' : 'made by the transport office'}.`,
          });
        const bad = active.find(
          (l) =>
            l.label.trim().length < 2 ||
            (l.kind === 'role' && !l.roleCode) ||
            (l.kind === 'designation' && !l.designation?.trim()) ||
            (l.kind === 'employee' && !l.employeeId),
        );
        if (bad)
          return setMsg({ ok: false, text: `Complete the level “${bad.label || 'unnamed'}”.` });
      }
      if (incharges.some((i) => !i.employeeId))
        return setMsg({
          ok: false,
          text: 'Choose the employee on every in-charge row, or remove it.',
        });
      const r = await saveTransportSetup({
        settings: s,
        levels: [...of('parent'), ...of('office')],
        incharges: incharges.map((i) => ({ routeId: i.routeId || null, employeeId: i.employeeId })),
      });
      setMsg(
        r.ok
          ? { ok: true, text: 'Saved. New requests follow these rules and levels.' }
          : { ok: false, text: r.error },
      );
    });

  const block = (a: Source, title: string, help: string) => {
    const list = of(a);
    return (
      <section className="ep-hd__form" aria-label={title}>
        <h3 className="ep-cdash__h3">{title}</h3>
        <p className="ep-field__help" style={{ margin: 0 }}>
          {help}
        </p>
        {list.map((l, i) => (
          <div key={`${a}-${String(i)}`} className="ep-hd__row">
            <label className="ep-field" htmlFor={`tl-label-${a}-${String(i)}`}>
              <span className="ep-field__label">Level {i + 1}</span>
              <input
                id={`tl-label-${a}-${String(i)}`}
                className="ep-input"
                maxLength={60}
                value={l.label}
                onChange={(e) => patch(a, i, { label: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor={`tl-kind-${a}-${String(i)}`}>
              <span className="ep-field__label">Who approves</span>
              <select
                id={`tl-kind-${a}-${String(i)}`}
                className="ep-select"
                value={l.kind}
                onChange={(e) => patch(a, i, { kind: e.target.value as TransportLevel['kind'] })}
              >
                {KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {l.kind === 'role' ? (
              <label className="ep-field" htmlFor={`tl-role-${a}-${String(i)}`}>
                <span className="ep-field__label">Role</span>
                <select
                  id={`tl-role-${a}-${String(i)}`}
                  className="ep-select"
                  value={l.roleCode ?? ''}
                  onChange={(e) => patch(a, i, { roleCode: e.target.value || null })}
                >
                  <option value="">Choose</option>
                  {setup.roles.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {l.kind === 'designation' ? (
              <label className="ep-field" htmlFor={`tl-des-${a}-${String(i)}`}>
                <span className="ep-field__label">Designation</span>
                <input
                  id={`tl-des-${a}-${String(i)}`}
                  className="ep-input"
                  maxLength={80}
                  list="tl-designations"
                  value={l.designation ?? ''}
                  onChange={(e) => patch(a, i, { designation: e.target.value })}
                />
              </label>
            ) : null}
            {l.kind === 'employee' ? (
              <label className="ep-field" htmlFor={`tl-emp-${a}-${String(i)}`}>
                <span className="ep-field__label">Employee</span>
                <select
                  id={`tl-emp-${a}-${String(i)}`}
                  className="ep-select"
                  value={l.employeeId ?? ''}
                  onChange={(e) => patch(a, i, { employeeId: e.target.value || null })}
                >
                  <option value="">Choose</option>
                  {setup.staff.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="ep-check" htmlFor={`tl-on-${a}-${String(i)}`}>
              <input
                id={`tl-on-${a}-${String(i)}`}
                type="checkbox"
                checked={l.active}
                onChange={(e) => patch(a, i, { active: e.target.checked })}
              />{' '}
              In use
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => move(a, i, -1)}
                disabled={i === 0}
                aria-label={`Move ${l.label} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => move(a, i, 1)}
                disabled={i === list.length - 1}
                aria-label={`Move ${l.label} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() =>
                  put(
                    a,
                    list.filter((_, n) => n !== i),
                  )
                }
                aria-label={`Remove ${l.label}`}
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
            disabled={list.length >= 6}
            onClick={() =>
              put(a, [
                ...list,
                {
                  source: a,
                  label: '',
                  kind: 'role',
                  roleCode: null,
                  designation: null,
                  employeeId: null,
                  active: true,
                },
              ])
            }
          >
            Add a level
          </button>
        </div>
      </section>
    );
  };

  return (
    <div className="ep-hd__form">
      <datalist id="tl-designations">
        {setup.designations.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <section className="ep-hd__form" aria-label="Charge rule">
        <h3 className="ep-cdash__h3">Charge rule</h3>
        <p className="ep-field__help" style={{ margin: 0 }}>
          Pick and drop from one stoppage is charged the full slab of that stoppage.
        </p>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor="ts-oneway">
            <span className="ep-field__label">Pick only or drop only: % of the slab</span>
            <input
              id="ts-oneway"
              type="number"
              className="ep-input"
              min={0}
              max={100}
              step={1}
              value={s.oneWayPercent}
              onChange={(e) =>
                setS({
                  ...s,
                  oneWayPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                })
              }
            />
          </label>
          <label className="ep-field" htmlFor="ts-two">
            <span className="ep-field__label">Pick and drop from two different stoppages</span>
            <select
              id="ts-two"
              className="ep-select"
              value={s.twoStopRule}
              onChange={(e) =>
                setS({
                  ...s,
                  twoStopRule: e.target.value as TransportSetup['settings']['twoStopRule'],
                })
              }
            >
              <option value="higher">Charge the higher of the two slabs</option>
              <option value="pick">Charge the slab of the pick stoppage</option>
              <option value="sum">Charge the one-way share of each slab, added</option>
            </select>
          </label>
        </div>
        <p className="ep-field__help" style={{ margin: 0 }}>
          Example with slabs of ₹1,000 and ₹1,500: pick only from the ₹1,000 stoppage ={' '}
          <strong>₹{Math.round(10 * s.oneWayPercent).toLocaleString('en-IN')}</strong>; pick and
          drop from the two ={' '}
          <strong>
            ₹
            {(s.twoStopRule === 'higher'
              ? 1500
              : s.twoStopRule === 'pick'
                ? 1000
                : Math.round(25 * s.oneWayPercent)
            ).toLocaleString('en-IN')}
          </strong>{' '}
          a month.
        </p>
      </section>
      <section className="ep-hd__form" aria-label="Transport in-charge">
        <h3 className="ep-cdash__h3">Transport in-charge</h3>
        <p className="ep-field__help" style={{ margin: 0 }}>
          Name who is in charge of transport. A row for <strong>the whole school</strong> covers
          every route; a row for one route makes that person the in-charge of that route only. A
          request waits on its route’s in-charge (else the school’s; else everyone with the
          Transport In-charge role), and parents see the name and phone for their child’s route.
        </p>
        {incharges.map((i, n) => (
          <div key={String(n)} className="ep-hd__row">
            <label className="ep-field" htmlFor={`ti-route-${String(n)}`}>
              <span className="ep-field__label">In charge of</span>
              <select
                id={`ti-route-${String(n)}`}
                className="ep-select"
                value={i.routeId}
                onChange={(e) =>
                  setIncharges(
                    incharges.map((x, k) => (k === n ? { ...x, routeId: e.target.value } : x)),
                  )
                }
              >
                <option value="">The whole school</option>
                {setup.routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    Route {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor={`ti-emp-${String(n)}`}>
              <span className="ep-field__label">Employee</span>
              <select
                id={`ti-emp-${String(n)}`}
                className="ep-select"
                value={i.employeeId}
                onChange={(e) =>
                  setIncharges(
                    incharges.map((x, k) => (k === n ? { ...x, employeeId: e.target.value } : x)),
                  )
                }
              >
                <option value="">Choose</option>
                {setup.staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button
                type="button"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                onClick={() => setIncharges(incharges.filter((_, k) => k !== n))}
                aria-label={`Remove in-charge row ${String(n + 1)}`}
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
            disabled={incharges.length >= 100}
            onClick={() => setIncharges([...incharges, { routeId: '', employeeId: '' }])}
          >
            Add an in-charge
          </button>
        </div>
      </section>
      {block(
        'parent',
        'Approval: a request from a family (portal)',
        'One after another, in this order. The last level’s approval updates the fees.',
      )}
      {block(
        'office',
        'Approval: a request made by the transport office',
        'The transport in-charge has already made the request, so it usually goes to the fee department only.',
      )}
      <section className="ep-hd__form" aria-label="Rules">
        <h3 className="ep-cdash__h3">Rules</h3>
        <label className="ep-check" htmlFor="ts-parent">
          <input
            id="ts-parent"
            type="checkbox"
            checked={s.parentCanApply}
            onChange={(e) => setS({ ...s, parentCanApply: e.target.checked })}
          />{' '}
          Parents and students may ask for transport, a change or a withdrawal from the portal
        </label>
        <label className="ep-check" htmlFor="ts-mail">
          <input
            id="ts-mail"
            type="checkbox"
            checked={s.notifyEmail}
            onChange={(e) => setS({ ...s, notifyEmail: e.target.checked })}
          />{' '}
          Email the approvers when a request waits on them, and the family when it is decided
        </label>
      </section>
      <p className="ep-field__help">
        A level that nobody holds is skipped. Requests already made keep the levels they were given.
        Routes, stoppages with their slab, vehicles, drivers and vendors are under Transport setup.
      </p>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="ep-btn ep-btn--primary" onClick={save} disabled={busy}>
          Save
        </button>
        {msg ? (
          <span className={msg.ok ? 'ep-field__help' : 'ep-field__error'} role="status">
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
