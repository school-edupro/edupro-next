'use client';
import { useState, useTransition } from 'react';
import { saveLeaveSetup } from '@/lib/attendance-actions';
import type { LeaveSetup } from '@/lib/attendance-plus';

type Level = LeaveSetup['levels'][number];
const CHAINS: Array<['short' | 'long', string, string]> = [
  ['short', 'Short leave', 'Usually the class teacher alone.'],
  [
    'long',
    'Long leave',
    'In order: usually the class teacher, the coordinator, then the principal.',
  ],
];

/**
 * Student leave set-up: after how many days a leave is "long", how far back a family may apply, and who
 * approves a short and a long leave, level by level. A long medical leave always needs a certificate.
 */
export function LeaveSetupForm({ setup }: { setup: LeaveSetup }) {
  const [longDays, setLongDays] = useState(setup.longDays);
  const [backDays, setBackDays] = useState(setup.backDays);
  const [levels, setLevels] = useState<Level[]>(setup.levels);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const patch = (n: number, p: Partial<Level>) =>
    setLevels(levels.map((l, i) => (i === n ? { ...l, ...p } : l)));
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveLeaveSetup({ longDays, backDays, levels });
      setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
    });
  return (
    <div className="ep-hd__form">
      <div className="ep-hd__row">
        <label className="ep-field" htmlFor="ls-long">
          <span className="ep-field__label">A leave is long when it is more than (days)</span>
          <input
            id="ls-long"
            type="number"
            className="ep-input"
            min={1}
            max={30}
            value={longDays}
            onChange={(e) => setLongDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <label className="ep-field" htmlFor="ls-back">
          <span className="ep-field__label">
            A family may apply for days gone, up to (days back)
          </span>
          <input
            id="ls-back"
            type="number"
            className="ep-input"
            min={0}
            max={30}
            value={backDays}
            onChange={(e) => setBackDays(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
          />
        </label>
      </div>
      <p className="ep-field__help" style={{ margin: 0 }}>
        A medical leave of more than {longDays} day(s) cannot be applied for without the doctor’s
        certificate.
      </p>
      {CHAINS.map(([chain, title, help]) => (
        <section key={chain} className="ep-hd__form" aria-label={title}>
          <h3 className="ep-cdash__h3">
            {title}:{' '}
            {chain === 'short'
              ? `up to ${String(longDays)} day(s)`
              : `more than ${String(longDays)} day(s)`}
          </h3>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {help} A level nobody holds is skipped.
          </p>
          {levels.map((l, n) =>
            l.chain !== chain ? null : (
              <div key={String(n)} className="ep-hd__row">
                <label className="ep-field" htmlFor={`ls-label-${String(n)}`}>
                  <span className="ep-field__label">Level name</span>
                  <input
                    id={`ls-label-${String(n)}`}
                    className="ep-input"
                    value={l.label}
                    maxLength={60}
                    onChange={(e) => patch(n, { label: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`ls-kind-${String(n)}`}>
                  <span className="ep-field__label">Who approves</span>
                  <select
                    id={`ls-kind-${String(n)}`}
                    className="ep-select"
                    value={
                      l.kind === 'class_teacher'
                        ? 'class_teacher'
                        : l.kind === 'role'
                          ? `role:${l.roleCode ?? ''}`
                          : `employee:${l.employeeId ?? ''}`
                    }
                    onChange={(e) => {
                      const [kind, id] = e.target.value.split(':');
                      patch(n, {
                        kind: kind as Level['kind'],
                        roleCode: kind === 'role' ? (id ?? null) : null,
                        employeeId: kind === 'employee' ? (id ?? null) : null,
                      });
                    }}
                  >
                    <option value="class_teacher">The class teacher of the student</option>
                    <optgroup label="Everyone with a role">
                      {setup.roles.map((r) => (
                        <option key={r.code} value={`role:${r.code}`}>
                          {r.code === 'school_admin' ? 'Principal / school admin' : r.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="One employee">
                      {setup.staff.map((p) => (
                        <option key={p.id} value={`employee:${p.id}`}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={l.active}
                    onChange={(e) => patch(n, { active: e.target.checked })}
                  />
                  In use
                </label>
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  onClick={() => setLevels(levels.filter((_, i) => i !== n))}
                  aria-label={`Remove the level ${l.label}`}
                >
                  Remove
                </button>
              </div>
            ),
          )}
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() =>
                setLevels([
                  ...levels,
                  {
                    chain,
                    label: 'New level',
                    kind: 'role',
                    roleCode: 'academic_coordinator',
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
      ))}
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
