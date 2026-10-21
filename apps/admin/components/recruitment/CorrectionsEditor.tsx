'use client';
import { useState, useTransition } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { saveCorrectionSettings } from '@/lib/recruitment-actions';
import type { CorrectionSettings } from '@/lib/recruitment';

/**
 * Putting an application right (docs/design/34-recruitment.md, part 8): who may undo a decision or move
 * an application to another stage at any time (roles and named employees), how long the one who made a
 * decision may undo it themselves, and how many days a candidate gets by default to send a correction.
 */
export function CorrectionsEditor({ initial }: { initial: CorrectionSettings }) {
  const canEdit = initial.can.manage;
  const [hours, setHours] = useState(String(initial.undoHours));
  const [days, setDays] = useState(String(initial.correctionDays));
  const [roles, setRoles] = useState(initial.undoRoles);
  const [staff, setStaff] = useState(initial.undoEmployeeIds);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const roleOptions = initial.roles.map((r) => ({ value: r.code, label: r.name }));
  const staffOptions = initial.staff.map((s) => ({
    value: s.id,
    label: `${s.name} (${s.code})${s.designation ? ` · ${s.designation}` : ''}`,
  }));
  const save = () => {
    const h = Number(hours);
    const d = Number(days);
    if (!Number.isInteger(h) || h < 0 || h > 720) {
      setMsg({ tone: 'danger', text: 'Hours to undo: a whole number from 0 to 720.' });
      return;
    }
    if (!Number.isInteger(d) || d < 1 || d > 60) {
      setMsg({ tone: 'danger', text: 'Days to correct: a whole number from 1 to 60.' });
      return;
    }
    start(async () => {
      const r = await saveCorrectionSettings({
        undoHours: h,
        undoRoles: roles,
        undoEmployeeIds: staff,
        correctionDays: d,
      });
      setMsg(r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error });
    });
  };
  const names = (ids: string[], opts: Array<{ value: string; label: string }>) =>
    ids.map((id) => opts.find((o) => o.value === id)?.label ?? id).join(', ') || 'Nobody';
  return (
    <section
      className="ep-card"
      aria-labelledby="rcx-h"
      style={{ padding: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}
    >
      <h2 id="rcx-h" className="ep-card__title">
        Putting an application right
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        A wrong result or a wrong stage can be undone, and an application can be moved to another
        stage (forward skips the stages between, back opens one again). Every change asks for a
        reason and stays in the application’s history.
      </p>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </p>
      ) : null}
      <div className="ep-grid-2">
        <div>
          <h3 className="ep-field__label">Undo and move at any time</h3>
          {canEdit ? (
            <>
              <ChipPicker
                label="Roles"
                options={roleOptions}
                value={roles}
                onChange={setRoles}
                help="Everyone with one of these roles."
              />
              <ChipPicker
                label="Named employees"
                options={staffOptions}
                value={staff}
                onChange={setStaff}
                help="Employees without a sign-in cannot act."
              />
            </>
          ) : (
            <dl className="ep-facts">
              <div>
                <dt>Roles</dt>
                <dd>{names(roles, roleOptions)}</dd>
              </div>
              <div>
                <dt>Named employees</dt>
                <dd>{names(staff, staffOptions)}</dd>
              </div>
            </dl>
          )}
        </div>
        <div>
          <label className="ep-field" htmlFor="rcx-hours">
            <span className="ep-field__label">Hours the one who decided may undo it</span>
            <input
              id="rcx-hours"
              type="number"
              className="ep-input"
              min={0}
              max={720}
              step={1}
              value={hours}
              disabled={!canEdit}
              onChange={(e) => setHours(e.target.value)}
              aria-describedby="rcx-hours-help"
            />
            <span id="rcx-hours-help" className="ep-field__help">
              The person who recorded a result may undo their own decision within this time. 0: only
              the roles and employees named here.
            </span>
          </label>
          <label className="ep-field" htmlFor="rcx-days">
            <span className="ep-field__label">Days a candidate gets to correct</span>
            <input
              id="rcx-days"
              type="number"
              className="ep-input"
              min={1}
              max={60}
              step={1}
              value={days}
              disabled={!canEdit}
              onChange={(e) => setDays(e.target.value)}
              aria-describedby="rcx-days-help"
            />
            <span id="rcx-days-help" className="ep-field__help">
              The date offered when the office sends an application back; it can be changed each
              time. A reminder goes a day before.
            </span>
          </label>
        </div>
      </div>
      {canEdit ? (
        <button type="button" className="ep-btn ep-btn--primary" disabled={pending} onClick={save}>
          Save
        </button>
      ) : null}
    </section>
  );
}
