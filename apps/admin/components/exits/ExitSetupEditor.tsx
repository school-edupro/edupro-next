'use client';
import { useState, useTransition } from 'react';
import { saveExitSetup } from '@/lib/exit-actions';
import type { ExitSetup } from '@/lib/exits';

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
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const setType = (i: number, patch: Partial<TypeRow>) =>
    setTypes((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setDept = (i: number, patch: Partial<DeptRow>) =>
    setDepts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <section
      className="ep-card"
      style={{ padding: 'var(--sp-4)', display: 'grid', gap: 'var(--sp-4)' }}
    >
      <div>
        <h2 className="ep-card__title">Exit types</h2>
        <div className="ep-table-wrap">
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
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">Clearance departments</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Dues from the system</th>
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
              setDepts((cur) => [...cur, { code: '', name: '', auto: null, active: true }])
            }
          >
            Add a department
          </button>
        ) : null}
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
                const t = withCode(types);
                used.clear();
                const d = withCode(depts);
                const r = await saveExitSetup({ types: t, noticeDays: notice, departments: d });
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
