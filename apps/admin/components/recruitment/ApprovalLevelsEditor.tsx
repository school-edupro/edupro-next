'use client';
import { useState, useTransition } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { saveVacancyApproval } from '@/lib/recruitment-actions';
import type { ApprovalBy, ApprovalLevel, ApprovalSetup } from '@/lib/recruitment';

type Row = ApprovalLevel & { key: string };

const BY: Record<Exclude<ApprovalBy, 'role'>, string> = {
  employees: 'Named employees',
  designation: 'Everyone with a designation',
  hod: 'HOD of the vacancy’s department',
};

/**
 * Who approves a vacancy, level by level (docs/design/34-recruitment.md, part 5): named employees, everyone
 * holding a designation, or the HOD of the vacancy's department. A level nobody holds is skipped; the
 * raiser's own level and a level of someone who already approved count as approved. Saving moves the
 * vacancies waiting to the new people at once.
 */
export function ApprovalLevelsEditor({ setup }: { setup: ApprovalSetup }) {
  const canEdit = setup.can.manage;
  const [rows, setRows] = useState<Row[]>(
    setup.levels.map((l, i) => ({ ...l, key: `l${String(i)}` })),
  );
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: string, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = () =>
    setRows((cur) => [
      ...cur,
      {
        key: `new-${String(Date.now())}`,
        name: '',
        by: 'employees',
        employeeIds: [],
        designation: null,
        roleCode: null,
        slaHours: 72,
      },
    ]);
  const staffOptions = setup.staff.map((s) => ({
    value: s.id,
    label: `${s.name} (${s.code})${s.designation ? ` · ${s.designation}` : ''}${s.signsIn ? '' : ' · no sign-in'}`,
  }));
  const withHod = setup.departments.filter((d) => d.hod?.signsIn);
  const roleName = (code: string | null) =>
    setup.roles.find((r) => r.code === code)?.name ?? code ?? '';
  const save = () =>
    start(async () => {
      const r = await saveVacancyApproval(rows.map(({ key: _key, ...l }) => l));
      setMsg(
        r.ok
          ? {
              tone: 'success',
              text: `Saved.${r.moved ? ` ${String(r.moved)} vacanc${r.moved > 1 ? 'ies' : 'y'} waiting moved to the new people.` : ''}${r.approved ? ` ${String(r.approved)} had nothing left to wait for and ${r.approved > 1 ? 'are' : 'is'} approved.` : ''}`,
            }
          : { tone: 'danger', text: r.error },
      );
    });
  return (
    <section className="ep-card" aria-labelledby="ra-h" style={{ padding: 'var(--sp-4)' }}>
      <h2 id="ra-h" className="ep-card__title">
        Who approves a vacancy
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        A vacancy sent for approval goes through these levels in order and shows in each approver’s
        header approvals. A level nobody holds is skipped. The level of the person who raised it,
        and a level of someone who already approved it, count as approved.
        {setup.waiting
          ? ` ${String(setup.waiting)} vacanc${setup.waiting > 1 ? 'ies are' : 'y is'} waiting now: saving moves ${setup.waiting > 1 ? 'them' : 'it'} to the new people.`
          : ''}
      </p>
      {msg ? (
        <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </p>
      ) : null}
      <ol className="ep-ra-levels">
        {rows.map((r, i) => {
          const n = String(i + 1);
          const holders = setup.designations.find((d) => d.name === r.designation)?.holders ?? 0;
          return (
            <li key={r.key} className="ep-ra-level">
              <div className="ep-ra-level__head">
                <span className="ep-ra-level__n" aria-hidden="true">
                  {n}
                </span>
                <label className="ep-field" htmlFor={`ra-name-${r.key}`}>
                  <span className="ep-field__label">Level {n}: name</span>
                  <input
                    id={`ra-name-${r.key}`}
                    className="ep-input"
                    maxLength={80}
                    placeholder="HOD review, Principal approval…"
                    value={r.name}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { name: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`ra-by-${r.key}`}>
                  <span className="ep-field__label">Who approves</span>
                  <select
                    id={`ra-by-${r.key}`}
                    className="ep-select"
                    value={r.by}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { by: e.target.value as ApprovalBy })}
                  >
                    {(Object.keys(BY) as Array<keyof typeof BY>).map((k) => (
                      <option key={k} value={k}>
                        {BY[k]}
                      </option>
                    ))}
                    {r.by === 'role' ? (
                      <option value="role">Role: {roleName(r.roleCode)} (set before)</option>
                    ) : null}
                  </select>
                </label>
                <label className="ep-field ep-ra-level__sla" htmlFor={`ra-sla-${r.key}`}>
                  <span className="ep-field__label">Reply within (hours)</span>
                  <input
                    id={`ra-sla-${r.key}`}
                    className="ep-input"
                    type="number"
                    min={1}
                    max={720}
                    value={r.slaHours ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      set(r.key, { slaHours: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                {canEdit ? (
                  <span className="ep-ra-level__tools">
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Move level ${n} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Move level ${n} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      aria-label={`Remove level ${n}`}
                      disabled={rows.length === 1}
                      onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                    >
                      Remove
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="ep-ra-level__who">
                {r.by === 'employees' ? (
                  canEdit ? (
                    <ChipPicker
                      label={`Level ${n}: employees`}
                      options={staffOptions}
                      value={r.employeeIds}
                      onChange={(next) => set(r.key, { employeeIds: next })}
                      help="Any one of them may approve. Employees without a sign-in cannot approve."
                    />
                  ) : (
                    <p className="ep-field__help">
                      {r.employeeIds
                        .map((id) => staffOptions.find((o) => o.value === id)?.label ?? id)
                        .join(', ') || 'Nobody picked'}
                    </p>
                  )
                ) : r.by === 'designation' ? (
                  <label className="ep-field" htmlFor={`ra-des-${r.key}`}>
                    <span className="ep-field__label">Level {n}: designation</span>
                    <select
                      id={`ra-des-${r.key}`}
                      className="ep-select"
                      value={r.designation ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => set(r.key, { designation: e.target.value || null })}
                    >
                      <option value="">Pick a designation</option>
                      {setup.designations.map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name} ({d.holders} can sign in)
                        </option>
                      ))}
                    </select>
                    {r.designation ? (
                      <span className="ep-field__help">
                        {holders
                          ? `Any of the ${String(holders)} holding it may approve.`
                          : 'Nobody who can sign in holds it yet.'}
                      </span>
                    ) : null}
                  </label>
                ) : r.by === 'hod' ? (
                  <div>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      The HOD set on the vacancy’s department approves. HODs who can sign in are set
                      for {withHod.length} of {setup.departments.length} departments; a vacancy of a
                      department without one skips this level.{' '}
                      <a href="/masters/staff?tab=departments">Set the HODs</a>
                    </p>
                    <details className="ep-ra-level__hods">
                      <summary>The departments and their HODs</summary>
                      <ul>
                        {setup.departments.map((d) => (
                          <li key={d.name}>
                            {d.name}:{' '}
                            {d.hod
                              ? `${d.hod.name} (${d.hod.code})${d.hod.signsIn ? '' : ' · no sign-in'}`
                              : 'not set'}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ) : (
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    Everyone with the role {roleName(r.roleCode)}, as set before. Pick employees, a
                    designation or the HOD to change it.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          <button
            type="button"
            className="ep-btn ep-btn--ghost"
            onClick={add}
            disabled={rows.length >= 6}
          >
            Add a level
          </button>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={save}
            disabled={pending}
          >
            Save
          </button>
        </div>
      ) : null}
    </section>
  );
}
