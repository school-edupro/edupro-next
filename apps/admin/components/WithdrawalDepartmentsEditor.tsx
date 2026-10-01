'use client';
import { useState, useTransition } from 'react';
import { saveWithdrawalDepartments } from '@/lib/actions';
import type { WithdrawalApprover, WithdrawalDepartment } from '@/lib/types';

type Row = Omit<WithdrawalDepartment, 'id' | 'approverLabels'> & { key: string; isNew?: boolean };

const approverText = (a: WithdrawalApprover) =>
  a.kind === 'office'
    ? 'School office'
    : a.kind === 'class_teacher'
      ? 'Class teacher'
      : a.kind === 'role'
        ? `Role: ${a.name ?? a.roleId}`
        : (a.name ?? `Employee ${a.userId}`);

/**
 * Withdrawal settings: the departments that clear a leaving student. Same step = in parallel; the
 * next step opens once all of the current one has cleared. Each department names who may clear it.
 */
export function WithdrawalDepartmentsEditor({
  departments,
  roles,
  staff,
}: {
  departments: WithdrawalDepartment[];
  roles: Array<{ id: string; name: string }>;
  staff: Array<{ userId: string; name: string; designation: string | null }>;
}) {
  const [rows, setRows] = useState<Row[]>(
    departments.map((d) => ({
      key: d.code,
      code: d.code,
      name: d.name,
      step: d.step,
      approvers: d.approvers,
      autoCheck: d.autoCheck,
      autoClear: d.autoClear,
      bypassAllowed: d.bypassAllowed,
      documentRequired: d.documentRequired,
      gatesTc: d.gatesTc,
      active: d.active,
    })),
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const options: Array<{ label: string; value: WithdrawalApprover }> = [
    { label: 'School office', value: { kind: 'office' } },
    { label: 'Class teacher', value: { kind: 'class_teacher' } },
    ...roles.map((r) => ({
      label: `Role: ${r.name}`,
      value: { kind: 'role' as const, roleId: r.id, name: r.name },
    })),
    ...staff.map((s) => ({
      label: `${s.name}${s.designation ? ` (${s.designation})` : ''}`,
      value: { kind: 'user' as const, userId: s.userId, name: s.name },
    })),
  ];
  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const sameApprover = (a: WithdrawalApprover, b: WithdrawalApprover) =>
    a.kind === b.kind &&
    (a.kind !== 'role' || (b.kind === 'role' && a.roleId === b.roleId)) &&
    (a.kind !== 'user' || (b.kind === 'user' && a.userId === b.userId));
  const save = () =>
    start(async () => {
      setMessage(null);
      const r = await saveWithdrawalDepartments(
        rows.map(({ key: _key, isNew: _isNew, ...d }) => d),
      );
      setMessage(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error });
    });
  const steps = [...new Set(rows.filter((r) => r.active).map((r) => r.step))].sort((a, b) => a - b);
  return (
    <div className="ep-wdset">
      <p className="ep-field__help">
        Order:{' '}
        {steps.length
          ? steps
              .map(
                (s) =>
                  `Step ${String(s)}: ${rows
                    .filter((r) => r.active && r.step === s)
                    .map((r) => r.name)
                    .join(', ')}`,
              )
              .join(' → ')
          : 'no active department'}
      </p>
      <div className="ep-table-wrap">
        <table className="ep-table ep-wdset__table">
          <caption className="ep-sr-only">Withdrawal departments</caption>
          <thead>
            <tr>
              <th scope="col">Department</th>
              <th scope="col">Step</th>
              <th scope="col">Cleared by (any one)</th>
              <th scope="col">Automatic check</th>
              <th scope="col">Rules</th>
              <th scope="col">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-inactive={r.active ? undefined : 'true'}>
                <td>
                  <label className="ep-sr-only" htmlFor={`n-${r.key}`}>
                    Name of {r.code}
                  </label>
                  <input
                    id={`n-${r.key}`}
                    className="ep-input"
                    value={r.name}
                    maxLength={80}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                  />
                  {r.isNew ? (
                    <>
                      <label className="ep-sr-only" htmlFor={`c-${r.key}`}>
                        Code
                      </label>
                      <input
                        id={`c-${r.key}`}
                        className="ep-input"
                        value={r.code}
                        placeholder="code, e.g. sports"
                        maxLength={40}
                        onChange={(e) =>
                          update(r.key, {
                            code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                          })
                        }
                      />
                    </>
                  ) : (
                    <div className="ep-field__help">{r.code}</div>
                  )}
                </td>
                <td>
                  <label className="ep-sr-only" htmlFor={`s-${r.key}`}>
                    Step of {r.name}
                  </label>
                  <select
                    id={`s-${r.key}`}
                    className="ep-select"
                    value={r.step}
                    onChange={(e) => update(r.key, { step: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <ul className="ep-wdset__approvers">
                    {r.approvers.map((a, i) => (
                      <li key={`${a.kind}-${String(i)}`}>
                        {approverText(a)}{' '}
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`Remove ${approverText(a)} from ${r.name}`}
                          disabled={r.approvers.length === 1}
                          onClick={() =>
                            update(r.key, { approvers: r.approvers.filter((_, j) => j !== i) })
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  {r.approvers.length < 4 ? (
                    <>
                      <label className="ep-sr-only" htmlFor={`a-${r.key}`}>
                        Add an approver to {r.name}
                      </label>
                      <input
                        id={`a-${r.key}`}
                        className="ep-input"
                        list="wd-approvers"
                        placeholder="Add: office, class teacher, role or name"
                        onChange={(e) => {
                          const hit = options.find((o) => o.label === e.target.value);
                          if (!hit) return;
                          if (!r.approvers.some((a) => sameApprover(a, hit.value)))
                            update(r.key, { approvers: [...r.approvers, hit.value] });
                          e.target.value = '';
                        }}
                      />
                    </>
                  ) : null}
                </td>
                <td>
                  <label className="ep-sr-only" htmlFor={`k-${r.key}`}>
                    Automatic check of {r.name}
                  </label>
                  <select
                    id={`k-${r.key}`}
                    className="ep-select"
                    value={r.autoCheck}
                    onChange={(e) =>
                      update(r.key, { autoCheck: e.target.value as Row['autoCheck'] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="fees">Fee dues</option>
                    <option value="library">Library books and fines</option>
                  </select>
                  {r.autoCheck !== 'none' ? (
                    <label className="ep-roles__tick" htmlFor={`ac-${r.key}`}>
                      <input
                        id={`ac-${r.key}`}
                        type="checkbox"
                        checked={r.autoClear}
                        onChange={(e) => update(r.key, { autoClear: e.target.checked })}
                      />{' '}
                      Clear by itself when nothing is due
                    </label>
                  ) : null}
                </td>
                <td>
                  {(
                    [
                      ['bypassAllowed', 'May be bypassed'],
                      ['documentRequired', 'Document required'],
                      ['gatesTc', 'TC after this clears'],
                    ] as const
                  ).map(([k, label]) => (
                    <label
                      key={k}
                      className="ep-roles__tick ep-wdset__rule"
                      htmlFor={`${k}-${r.key}`}
                    >
                      <input
                        id={`${k}-${r.key}`}
                        type="checkbox"
                        checked={r[k]}
                        onChange={(e) => update(r.key, { [k]: e.target.checked })}
                      />{' '}
                      {label}
                    </label>
                  ))}
                </td>
                <td>
                  <label className="ep-roles__tick" htmlFor={`on-${r.key}`}>
                    <input
                      id={`on-${r.key}`}
                      type="checkbox"
                      checked={r.active}
                      onChange={(e) => update(r.key, { active: e.target.checked })}
                    />{' '}
                    <span className="ep-sr-only">{r.name} </span>active
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="wd-approvers">
        {options.map((o) => (
          <option key={o.label} value={o.label} />
        ))}
      </datalist>
      <div className="ep-wdset__actions">
        <button
          type="button"
          className="ep-btn ep-btn--secondary ep-btn--sm"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: `new-${String(Date.now())}`,
                isNew: true,
                code: '',
                name: '',
                step: Math.max(1, ...rs.map((x) => x.step)),
                approvers: [{ kind: 'office' }],
                autoCheck: 'none',
                autoClear: false,
                bypassAllowed: true,
                documentRequired: false,
                gatesTc: false,
                active: true,
              },
            ])
          }
        >
          Add department
        </button>
        <button type="button" className="ep-btn ep-btn--primary" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save departments'}
        </button>
        <span aria-live="polite" className={message?.ok ? 'ep-field__help' : 'ep-field__error'}>
          {message?.text}
        </span>
      </div>
    </div>
  );
}
