'use client';
import { useState, useTransition } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { saveExitSetup } from '@/lib/exit-actions';
import type { ClearanceApprover, ExitSetup } from '@/lib/exits';

type TypeRow = ExitSetup['types'][number];
type DeptRow = ExitSetup['departments'][number];
const codeOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'x$1')
    .slice(0, 40) || 'item';

/**
 * Exit set-up (docs/design/38, part 5): the exit types (which the staff may ask for, which count the
 * notice), the notice period per employee type, and the clearance departments of part 6.
 */
export function ExitSetupEditor({ setup }: { setup: ExitSetup }) {
  const canEdit = setup.can.manage;
  const [types, setTypes] = useState<TypeRow[]>(setup.types);
  const [notice, setNotice] = useState(setup.noticeDays);
  const [depts, setDepts] = useState<DeptRow[]>(setup.departments);
  const [fnfBy, setFnfBy] = useState<ClearanceApprover[]>(setup.fnfApprovers);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const setType = (i: number, patch: Partial<TypeRow>) =>
    setTypes((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setDept = (i: number, patch: Partial<DeptRow>) =>
    setDepts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const has = (d: DeptRow, kind: 'office' | 'hod') => d.approvers.some((a) => a.kind === kind);
  const toggle = (i: number, kind: 'office' | 'hod', on: boolean) =>
    setDept(i, {
      approvers: on
        ? [...depts[i]!.approvers, { kind }]
        : depts[i]!.approvers.filter((a) => a.kind !== kind),
    });
  const rolesOf = (d: DeptRow) => d.approvers.flatMap((a) => (a.kind === 'role' ? [a.code] : []));
  const setRoles = (i: number, codes: string[]) =>
    setDept(i, {
      approvers: [
        ...depts[i]!.approvers.filter((a) => a.kind !== 'role'),
        ...codes.map((code): ClearanceApprover => ({ kind: 'role', code })),
      ],
    });
  const roleOptions = setup.roles.map((r) => ({ value: r.code, label: r.name }));

  return (
    <section
      className="ep-card"
      // one column that may shrink: the wide tables scroll inside their own box, not the page
      style={{
        padding: 'var(--sp-4)',
        display: 'grid',
        gap: 'var(--sp-4)',
        gridTemplateColumns: 'minmax(0, 1fr)',
      }}
    >
      <div>
        <h2 className="ep-card__title">Exit types</h2>
        <div className="ep-table-wrap" style={{ position: 'relative' }}>
          <table className="ep-table">
            <caption className="ep-sr-only">Exit types</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Staff may ask in the app</th>
                <th scope="col">Notice period counts</th>
                <th scope="col">In use</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t, i) => (
                <tr key={`${t.code}-${String(i)}`}>
                  <td>
                    <input
                      className="ep-input"
                      aria-label={`Name of exit type ${String(i + 1)}`}
                      maxLength={80}
                      value={t.name}
                      disabled={!canEdit}
                      onChange={(e) => setType(i, { name: e.target.value })}
                    />
                  </td>
                  {(['staffMayApply', 'noticeApplies', 'active'] as const).map((k) => (
                    <td key={k}>
                      <label className="ep-check">
                        <input
                          type="checkbox"
                          className="ep-check__input"
                          checked={t[k]}
                          disabled={!canEdit}
                          onChange={(e) => setType(i, { [k]: e.target.checked })}
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                        <span className="ep-sr-only">
                          {t.name}:{' '}
                          {k === 'staffMayApply'
                            ? 'staff may ask in the app'
                            : k === 'noticeApplies'
                              ? 'notice period counts'
                              : 'in use'}
                        </span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={types.length >= 20}
            onClick={() =>
              setTypes((cur) => [
                ...cur,
                { code: '', name: '', staffMayApply: false, noticeApplies: false, active: true },
              ])
            }
          >
            Add an exit type
          </button>
        ) : null}
      </div>
      <div>
        <h2 className="ep-card__title">Notice period (days)</h2>
        <div className="ep-profile__grid">
          {setup.employeeTypes.map((t) => (
            <label key={t.code} className="ep-field" htmlFor={`xs-n-${t.code}`}>
              <span className="ep-field__label">{t.name}</span>
              <input
                id={`xs-n-${t.code}`}
                className="ep-input"
                type="number"
                min={0}
                max={365}
                value={notice[t.code]}
                disabled={!canEdit}
                onChange={(e) =>
                  setNotice((n) => ({ ...n, [t.code]: Number(e.target.value || 0) }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        <h2 className="ep-card__title">No-dues clearance departments</h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Each clears an exit or notes dues. Library and assets fill in what the system knows (books
          on loan, unpaid library charges).
        </p>
        <div className="ep-table-wrap" style={{ position: 'relative' }}>
          <table className="ep-table">
            <caption className="ep-sr-only">Clearance departments</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Dues from the system</th>
                <th scope="col">Who clears</th>
                <th scope="col">In use</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d, i) => (
                <tr key={`${d.code}-${String(i)}`}>
                  <td>
                    <input
                      className="ep-input"
                      aria-label={`Name of department ${String(i + 1)}`}
                      maxLength={80}
                      value={d.name}
                      disabled={!canEdit}
                      onChange={(e) => setDept(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="ep-select"
                      aria-label={`${d.name || 'Department'}: dues from the system`}
                      value={d.auto ?? ''}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setDept(i, { auto: (e.target.value || null) as DeptRow['auto'] })
                      }
                    >
                      <option value="">None</option>
                      <option value="library">Library books and charges</option>
                      <option value="assets">Assets issued</option>
                    </select>
                  </td>
                  <td style={{ minWidth: '16rem' }}>
                    {(['office', 'hod'] as const).map((k) => (
                      <label key={k} className="ep-check">
                        <input
                          type="checkbox"
                          className="ep-check__input"
                          checked={has(d, k)}
                          disabled={!canEdit}
                          onChange={(e) => toggle(i, k, e.target.checked)}
                        />
                        <span className="ep-check__box" aria-hidden="true" />
                        <span className="ep-check__text">
                          {k === 'office' ? 'The office' : 'HOD of the employee'}
                        </span>
                      </label>
                    ))}
                    {canEdit ? (
                      <ChipPicker
                        label={`${d.name || 'Department'}: roles that clear`}
                        options={roleOptions}
                        value={rolesOf(d)}
                        onChange={(next) => setRoles(i, next)}
                      />
                    ) : (
                      <span className="ep-field__help">
                        {rolesOf(d)
                          .map((c) => setup.roles.find((r) => r.code === c)?.name ?? c)
                          .join(', ')}
                      </span>
                    )}
                    {d.approvers.some((a) => a.kind === 'user') ? (
                      <span className="ep-field__help">and named people set before</span>
                    ) : null}
                  </td>
                  <td>
                    <label className="ep-check">
                      <input
                        type="checkbox"
                        className="ep-check__input"
                        checked={d.active}
                        disabled={!canEdit}
                        onChange={(e) => setDept(i, { active: e.target.checked })}
                      />
                      <span className="ep-check__box" aria-hidden="true" />
                      <span className="ep-sr-only">{d.name}: in use</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            disabled={depts.length >= 20}
            onClick={() =>
              setDepts((cur) => [
                ...cur,
                { code: '', name: '', auto: null, active: true, approvers: [{ kind: 'office' }] },
              ])
            }
          >
            Add a department
          </button>
        ) : null}
      </div>
      <div>
        <h2 className="ep-card__title">Who approves the full and final statement</h2>
        <label className="ep-check">
          <input
            type="checkbox"
            className="ep-check__input"
            checked={fnfBy.some((a) => a.kind === 'office')}
            disabled={!canEdit}
            onChange={(e) =>
              setFnfBy((cur) =>
                e.target.checked
                  ? [...cur, { kind: 'office' }]
                  : cur.filter((a) => a.kind !== 'office'),
              )
            }
          />
          <span className="ep-check__box" aria-hidden="true" />
          <span className="ep-check__text">The office (exit rights)</span>
        </label>
        {canEdit ? (
          <ChipPicker
            label="Roles that approve the statement"
            options={roleOptions}
            value={fnfBy.flatMap((a) => (a.kind === 'role' ? [a.code] : []))}
            onChange={(next) =>
              setFnfBy((cur) => [
                ...cur.filter((a) => a.kind !== 'role'),
                ...next.map((code): ClearanceApprover => ({ kind: 'role', code })),
              ])
            }
            help="Accounts prepares it; any one of these approves it before it is paid."
          />
        ) : (
          <p className="ep-field__help">
            {fnfBy
              .map((a) =>
                a.kind === 'role'
                  ? (setup.roles.find((r) => r.code === a.code)?.name ?? a.code)
                  : a.kind === 'office'
                    ? 'The office'
                    : 'A named person',
              )
              .join(', ')}
          </p>
        )}
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
        >
          {msg.text}
        </div>
      ) : null}
      {canEdit ? (
        <div className="ep-form-actions">
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const used = new Set<string>();
                const withCode = <T extends { code: string; name: string }>(xs: T[]) =>
                  xs
                    .filter((x) => x.name.trim())
                    .map((x) => {
                      let code = x.code || codeOf(x.name);
                      while (used.has(code)) code = `${code}_2`.slice(0, 40);
                      used.add(code);
                      return { ...x, name: x.name.trim(), code };
                    });
                if (depts.some((d) => d.name.trim() && d.active && !d.approvers.length))
                  return setMsg({
                    tone: 'danger',
                    text: 'Each department in use needs someone who clears it',
                  });
                const t = withCode(types);
                used.clear();
                const d = withCode(depts);
                if (!fnfBy.length)
                  return setMsg({
                    tone: 'danger',
                    text: 'Someone must approve the full and final statement',
                  });
                const r = await saveExitSetup({
                  types: t,
                  noticeDays: notice,
                  departments: d,
                  fnfApprovers: fnfBy,
                });
                if (r.ok) {
                  setTypes(t);
                  setDepts(d);
                }
                setMsg(
                  r.ok ? { tone: 'success', text: 'Saved.' } : { tone: 'danger', text: r.error },
                );
              })
            }
          >
            Save
          </button>
        </div>
      ) : null}
    </section>
  );
}
