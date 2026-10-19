'use client';
import { useState, useTransition } from 'react';
import { saveAcrLevels } from '@/lib/acr-actions';
import { KIND_LABEL, type AcrLevel, type LevelKind, type StaffGroup } from '@/lib/acr';

/**
 * The levels of one staff group's ACRs, in order (docs/design/32-employee-acr.md): how many, who fills each
 * (from the employee's own record: ACR HOD, L1–L3; or the same people for everyone: a role, a designation,
 * a named person) and whether it rates the questions or reviews the level before.
 */
export function AcrLevelsEditor({
  group,
  title,
  initial,
  roles,
  designations,
  staff,
  canEdit,
}: {
  group: StaffGroup;
  title: string;
  initial: AcrLevel[];
  roles: Array<{ code: string; name: string }>;
  designations: string[];
  staff: Array<{ id: string; name: string; code: string }>;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<AcrLevel[]>(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<AcrLevel>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setRows((r) => {
      const n = [...r];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
  const save = () =>
    start(async () => {
      const r = await saveAcrLevels(group, rows);
      setMsg(r.ok ? { tone: 'success', text: 'Levels saved.' } : { tone: 'danger', text: r.error });
    });
  const id = (k: string, i: number) => `acr-${group}-${k}-${String(i)}`;

  return (
    <section
      className="ep-card"
      aria-labelledby={`acr-${group}-h`}
      style={{ padding: 'var(--sp-4)' }}
    >
      <h2 id={`acr-${group}-h`} className="ep-card__title">
        {title}
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        After the employee submits the self-appraisal, the ACR goes to each level in this order.
      </p>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {msg.text}
        </div>
      ) : null}
      <ol className="ep-acr-levels">
        {rows.map((l, i) => (
          <li key={`${String(i)}-${l.kind}`} className="ep-acr-level">
            <span className="ep-acr-level__n" aria-hidden="true">
              {i + 1}
            </span>
            <div className="ep-fit-row">
              <label className="ep-field" htmlFor={id('label', i)}>
                <span className="ep-field__label">Name of the level</span>
                <input
                  id={id('label', i)}
                  className="ep-input"
                  value={l.label}
                  maxLength={60}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { label: e.target.value })}
                />
              </label>
              <label className="ep-field" htmlFor={id('kind', i)}>
                <span className="ep-field__label">Who fills it</span>
                <select
                  id={id('kind', i)}
                  className="ep-select"
                  value={l.kind}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { kind: e.target.value as LevelKind })}
                >
                  {(Object.keys(KIND_LABEL) as LevelKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              {l.kind === 'role' ? (
                <label className="ep-field" htmlFor={id('role', i)}>
                  <span className="ep-field__label">Role</span>
                  <select
                    id={id('role', i)}
                    className="ep-select"
                    value={l.roleCode ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { roleCode: e.target.value || null })}
                  >
                    <option value="">Choose…</option>
                    {roles.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : l.kind === 'designation' || l.kind === 'acr_reviewer' ? (
                <label className="ep-field" htmlFor={id('desig', i)}>
                  <span className="ep-field__label">
                    {l.kind === 'acr_reviewer'
                      ? 'When nobody is set on the record: everyone with this designation'
                      : 'Designation'}
                  </span>
                  <select
                    id={id('desig', i)}
                    className="ep-select"
                    value={l.designation ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { designation: e.target.value || null })}
                  >
                    <option value="">Choose…</option>
                    {/* a designation saved earlier stays visible even when no one holds it now */}
                    {l.designation && !designations.includes(l.designation) ? (
                      <option value={l.designation}>{l.designation}</option>
                    ) : null}
                    {designations.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              ) : l.kind === 'employee' ? (
                <label className="ep-field" htmlFor={id('emp', i)}>
                  <span className="ep-field__label">Person</span>
                  <select
                    id={id('emp', i)}
                    className="ep-select"
                    value={l.employeeId ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { employeeId: e.target.value || null })}
                  >
                    <option value="">Choose…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="ep-field__help ep-acr-level__note">
                  Set per employee under the Assessors tab (or on the record, Approvers section).
                </p>
              )}
              <label className="ep-field" htmlFor={id('action', i)}>
                <span className="ep-field__label">What they do</span>
                <select
                  id={id('action', i)}
                  className="ep-select"
                  value={l.action}
                  disabled={!canEdit}
                  onChange={(e) => set(i, { action: e.target.value as 'rate' | 'review' })}
                >
                  <option value="rate">Rate the questions and write remarks</option>
                  <option value="review">Review: grade, agree or not, remarks</option>
                </select>
              </label>
            </div>
            {canEdit ? (
              <div className="ep-acr-level__tools">
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move level ${String(i + 1)} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Move level ${String(i + 1)} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Remove level ${String(i + 1)}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={rows.length >= 6}
            onClick={() =>
              setRows((r) => [
                ...r,
                {
                  label: `Level ${String(r.length + 1)}`,
                  kind: 'approver_l1',
                  roleCode: null,
                  designation: null,
                  employeeId: null,
                  action: 'review',
                },
              ])
            }
          >
            + Add level
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary ep-btn--sm"
            onClick={save}
            disabled={pending}
          >
            Save levels
          </button>
        </div>
      ) : null}
    </section>
  );
}
