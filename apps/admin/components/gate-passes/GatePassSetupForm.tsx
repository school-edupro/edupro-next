'use client';
import { useState, useTransition } from 'react';
import { saveGatePassSetup } from '@/lib/gate-pass-actions';
import type { GatePassLevel, GatePassSetup } from '@/lib/gate-passes';

type Audience = 'student' | 'staff';
const KINDS: Array<[GatePassLevel['kind'], string]> = [
  ['class_teacher', 'The pupil’s class teacher'],
  ['role', 'Everyone with a role'],
  ['designation', 'Everyone with a designation'],
  ['employee', 'One employee'],
];

/**
 * Gate pass set-up: for pupil passes and for staff passes, who approves and in which order, whether the
 * levels go one after another or any N of them are enough, and the parent's one-time code at hand-over.
 */
export function GatePassSetupForm({ setup }: { setup: GatePassSetup }) {
  const [s, setS] = useState(setup.settings);
  const [levels, setLevels] = useState<GatePassLevel[]>(setup.levels);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  const of = (a: Audience) => levels.filter((l) => l.audience === a);
  const put = (a: Audience, next: GatePassLevel[]) =>
    setLevels([...levels.filter((l) => l.audience !== a), ...next]);
  const patch = (a: Audience, i: number, p: Partial<GatePassLevel>) =>
    put(
      a,
      of(a).map((l, n) => (n === i ? { ...l, ...p } : l)),
    );
  const move = (a: Audience, i: number, by: number) => {
    const list = [...of(a)];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    put(a, list);
  };

  const save = () =>
    start(async () => {
      setMsg(null);
      for (const a of ['student', 'staff'] as const) {
        const active = of(a).filter((l) => l.active);
        if (!active.length)
          return setMsg({
            ok: false,
            text: `Keep at least one approval level for ${a === 'student' ? 'pupil' : 'staff'} passes.`,
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
      const r = await saveGatePassSetup({
        settings: s,
        levels: [...of('student'), ...of('staff')],
      });
      setMsg(
        r.ok
          ? { ok: true, text: 'Saved. New requests follow these levels.' }
          : { ok: false, text: r.error },
      );
    });

  const block = (a: Audience, title: string) => {
    const mode = a === 'student' ? s.studentMode : s.staffMode;
    const need = a === 'student' ? s.studentNeed : s.staffNeed;
    const list = of(a);
    return (
      <section className="ep-hd__form" aria-label={title}>
        <h3 className="ep-cdash__h3">{title}</h3>
        <div className="ep-hd__row">
          <label className="ep-field" htmlFor={`gs-mode-${a}`}>
            <span className="ep-field__label">How the levels approve</span>
            <select
              id={`gs-mode-${a}`}
              className="ep-select"
              value={mode}
              onChange={(e) =>
                setS({
                  ...s,
                  [a === 'student' ? 'studentMode' : 'staffMode']: e.target.value as
                    'sequence' | 'any',
                })
              }
            >
              <option value="sequence">One after another, in this order (all must approve)</option>
              <option value="any">Any of them, at the same time</option>
            </select>
          </label>
          {mode === 'any' ? (
            <label className="ep-field" htmlFor={`gs-need-${a}`}>
              <span className="ep-field__label">How many approvals are enough</span>
              <input
                id={`gs-need-${a}`}
                type="number"
                className="ep-input"
                min={1}
                max={6}
                value={need}
                onChange={(e) =>
                  setS({
                    ...s,
                    [a === 'student' ? 'studentNeed' : 'staffNeed']: Math.min(
                      6,
                      Math.max(1, Number(e.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
          ) : null}
        </div>
        {list.map((l, i) => (
          <div key={`${a}-${String(i)}`} className="ep-hd__row">
            <label className="ep-field" htmlFor={`gl-label-${a}-${String(i)}`}>
              <span className="ep-field__label">Level {i + 1}</span>
              <input
                id={`gl-label-${a}-${String(i)}`}
                className="ep-input"
                maxLength={60}
                value={l.label}
                onChange={(e) => patch(a, i, { label: e.target.value })}
              />
            </label>
            <label className="ep-field" htmlFor={`gl-kind-${a}-${String(i)}`}>
              <span className="ep-field__label">Who approves</span>
              <select
                id={`gl-kind-${a}-${String(i)}`}
                className="ep-select"
                value={l.kind}
                onChange={(e) => patch(a, i, { kind: e.target.value as GatePassLevel['kind'] })}
              >
                {KINDS.filter(([k]) => a === 'student' || k !== 'class_teacher').map(
                  ([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
            {l.kind === 'role' ? (
              <label className="ep-field" htmlFor={`gl-role-${a}-${String(i)}`}>
                <span className="ep-field__label">Role</span>
                <select
                  id={`gl-role-${a}-${String(i)}`}
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
              <label className="ep-field" htmlFor={`gl-des-${a}-${String(i)}`}>
                <span className="ep-field__label">Designation</span>
                <input
                  id={`gl-des-${a}-${String(i)}`}
                  className="ep-input"
                  maxLength={80}
                  list="gl-designations"
                  value={l.designation ?? ''}
                  onChange={(e) => patch(a, i, { designation: e.target.value })}
                />
              </label>
            ) : null}
            {l.kind === 'employee' ? (
              <label className="ep-field" htmlFor={`gl-emp-${a}-${String(i)}`}>
                <span className="ep-field__label">Employee</span>
                <select
                  id={`gl-emp-${a}-${String(i)}`}
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
            <label className="ep-check" htmlFor={`gl-on-${a}-${String(i)}`}>
              <input
                id={`gl-on-${a}-${String(i)}`}
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
            disabled={list.length >= 8}
            onClick={() =>
              put(a, [
                ...list,
                {
                  audience: a,
                  label: '',
                  kind: 'designation',
                  roleCode: null,
                  designation: '',
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
      <datalist id="gl-designations">
        {setup.designations.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      {block('student', 'Pupil passes (parent or front desk asks)')}
      {block('staff', 'Staff passes (RGP / NRGP)')}
      <section className="ep-hd__form" aria-label="Rules">
        <h3 className="ep-cdash__h3">Rules</h3>
        <label className="ep-check" htmlFor="gs-otp">
          <input
            id="gs-otp"
            type="checkbox"
            checked={s.handoverOtp}
            onChange={(e) => setS({ ...s, handoverOtp: e.target.checked })}
          />{' '}
          When someone not on the pupil’s record collects the child, the parent confirms with a
          one-time code at the front desk
        </label>
        <label className="ep-check" htmlFor="gs-mail">
          <input
            id="gs-mail"
            type="checkbox"
            checked={s.notifyEmail}
            onChange={(e) => setS({ ...s, notifyEmail: e.target.checked })}
          />{' '}
          Email the approvers when a pass waits on them, and the family or employee when it is
          decided (with the pass as PDF)
        </label>
      </section>
      <p className="ep-field__help">
        A level that nobody holds is skipped. An employee never approves their own pass. Passes
        already asked keep the levels they were given.
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
