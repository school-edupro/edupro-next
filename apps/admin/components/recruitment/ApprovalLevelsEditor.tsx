'use client';
import { useState, useTransition } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { saveVacancyApproval } from '@/lib/recruitment-actions';
import type { ApprovalBy, ApprovalLevel, ApprovalSetup } from '@/lib/recruitment';

type Row = ApprovalLevel & { key: string };

const BY: Record<Exclude<ApprovalBy, 'role' | 'manager'>, string> = {
  employees: 'Named employees',
  designation: 'Everyone with a designation',
  hod: 'HOD of the vacancy’s department',
};
type SaveLevels = (
  levels: ApprovalLevel[],
) => Promise<{ ok: true; moved: number; approved: number } | { ok: false; error: string }>;

/**
 * Who approves a vacancy, level by level (docs/design/34-recruitment.md, part 5): named employees, everyone
 * holding a designation, or the HOD of the vacancy's department. A level nobody holds is skipped; the
 * raiser's own level and a level of someone who already approved count as approved. Saving moves the
 * vacancies waiting to the new people at once.
 */
export function ApprovalLevelsEditor({
  setup,
  save: saveLevels = saveVacancyApproval,
  title = 'Who approves a vacancy',
  intro,
  hodLabel = 'HOD of the vacancy’s department',
  hodHelp = 'The HOD set on the vacancy’s department approves.',
  waitingNoun = ['vacancy', 'vacancies'],
  allowManager = false,
  allowRole = false,
  idPrefix = 'ra',
}: {
  setup: ApprovalSetup;
  /** Saves the levels (vacancy approval by default). */
  save?: SaveLevels;
  title?: string;
  intro?: string;
  hodLabel?: string;
  hodHelp?: string;
  waitingNoun?: [string, string];
  /** Offer the reporting manager of the employee the request is about (employee exit). */
  allowManager?: boolean;
  /** Offer everyone holding a role (the principal's sign-in, accounts …). */
  allowRole?: boolean;
  idPrefix?: string;
}) {
  const canEdit = setup.can.manage;
  const choices: Array<[ApprovalBy, string]> = [
    ['employees', BY.employees],
    ['designation', BY.designation],
    ['hod', hodLabel],
    ...(allowManager
      ? [['manager', 'Reporting manager of the employee'] as [ApprovalBy, string]]
      : []),
  ];
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
      const r = await saveLevels(rows.map(({ key: _key, ...l }) => l));
      setMsg(
        r.ok
          ? {
              tone: 'success',
              text: `Saved.${r.moved ? ` ${String(r.moved)} ${r.moved > 1 ? waitingNoun[1] : waitingNoun[0]} waiting moved to the new people.` : ''}${r.approved ? ` ${String(r.approved)} had nothing left to wait for and ${r.approved > 1 ? 'are' : 'is'} approved.` : ''}`,
            }
          : { tone: 'danger', text: r.error },
      );
    });
  return (
    <section
      className="ep-card"
      aria-labelledby={`${idPrefix}-h`}
      style={{ padding: 'var(--sp-4)' }}
    >
      <h2 id={`${idPrefix}-h`} className="ep-card__title">
        {title}
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {intro ??
          'A vacancy sent for approval goes through these levels in order and shows in each approver’s header approvals. A level nobody holds is skipped. The level of the person who raised it, and a level of someone who already approved it, count as approved.'}
        {setup.waiting
          ? ` ${String(setup.waiting)} ${setup.waiting > 1 ? `${waitingNoun[1]} are` : `${waitingNoun[0]} is`} waiting now: saving moves ${setup.waiting > 1 ? 'them' : 'it'} to the new people.`
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
                <label className="ep-field" htmlFor={`${idPrefix}-name-${r.key}`}>
                  <span className="ep-field__label">Level {n}: name</span>
                  <input
                    id={`${idPrefix}-name-${r.key}`}
                    className="ep-input"
                    maxLength={80}
                    placeholder="HOD review, Principal approval…"
                    value={r.name}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { name: e.target.value })}
                  />
                </label>
                <label className="ep-field" htmlFor={`${idPrefix}-by-${r.key}`}>
                  <span className="ep-field__label">Who approves</span>
                  <select
                    id={`${idPrefix}-by-${r.key}`}
                    className="ep-select"
                    value={r.by}
                    disabled={!canEdit}
                    onChange={(e) => set(r.key, { by: e.target.value as ApprovalBy })}
                  >
                    {choices.map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                    {r.by === 'role' && !allowRole ? (
                      <option value="role">Role: {roleName(r.roleCode)} (set before)</option>
                    ) : null}
                  </select>
                </label>
                <label className="ep-field ep-ra-level__sla" htmlFor={`${idPrefix}-sla-${r.key}`}>
                  <span className="ep-field__label">Reply within (hours)</span>
                  <input
                    id={`${idPrefix}-sla-${r.key}`}
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
                  <label className="ep-field" htmlFor={`${idPrefix}-des-${r.key}`}>
                    <span className="ep-field__label">Level {n}: designation</span>
                    <select
                      id={`${idPrefix}-des-${r.key}`}
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
                      {hodHelp} HODs who can sign in are set for {withHod.length} of{' '}
                      {setup.departments.length} departments; a department without one skips this
                      level. <a href="/masters/staff?tab=departments">Set the HODs</a>
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
                ) : r.by === 'manager' ? (
                  <p className="ep-field__help" style={{ margin: 0 }}>
                    The manager the employee reports to this year (set on the employee’s posting)
                    approves; an employee without one skips this level.
                  </p>
                ) : allowRole ? (
                  <label className="ep-field" htmlFor={`${idPrefix}-role-${r.key}`}>
                    <span className="ep-field__label">Level {n}: role</span>
                    <select
                      id={`${idPrefix}-role-${r.key}`}
                      className="ep-select"
                      value={r.roleCode ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => set(r.key, { roleCode: e.target.value || null })}
                    >
                      <option value="">Pick a role</option>
                      {setup.roles.map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
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
