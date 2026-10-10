'use client';

import { useMemo, useState } from 'react';
import {
  MATRIX_COLUMNS,
  buildMatrix,
  columnCodes,
  type MatrixModule,
  type MatrixTick,
} from '@/lib/permission-matrix';
import type { Permission } from '@/lib/types';

/**
 * The rights of a role as a grid: features down the side, View / Add-Edit / Delete / Approve / Other
 * across. Whole rows, columns and modules can be ticked at once. Ticked codes are posted as
 * `permissions`.
 */
export function PermissionMatrix({
  permissions,
  held,
  readOnly = false,
}: {
  permissions: Permission[];
  held: string[];
  readOnly?: boolean;
}) {
  const modules = useMemo(() => buildMatrix(permissions), [permissions]);
  const [on, setOn] = useState<Set<string>>(() => new Set(held));
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(modules.filter((m) => m.codes.some((c) => held.includes(c))).map((m) => m.key)),
  );
  const [q, setQ] = useState('');
  const [onlyTicked, setOnlyTicked] = useState(false);
  const [explain, setExplain] = useState(false);

  const set = (codes: string[], value: boolean) =>
    setOn((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (value) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  const all = (codes: string[]) => codes.length > 0 && codes.every((c) => on.has(c));
  const some = (codes: string[]) => codes.some((c) => on.has(c));
  const needle = q.trim().toLowerCase();
  const visible = (m: MatrixModule) =>
    m.rows.filter(
      (r) =>
        (!onlyTicked || some(r.codes)) &&
        (!needle ||
          m.label.toLowerCase().includes(needle) ||
          r.label.toLowerCase().includes(needle) ||
          MATRIX_COLUMNS.some((c) =>
            r.cells[c.key].some(
              (t) =>
                t.description.toLowerCase().includes(needle) ||
                t.code.toLowerCase().includes(needle),
            ),
          )),
    );
  const shown = modules.map((m) => ({ m, rows: visible(m) })).filter((x) => x.rows.length > 0);

  const tick = (t: MatrixTick) => (
    <label key={t.code} className="ep-check" htmlFor={`perm-${t.code}`} title={t.description}>
      <input
        id={`perm-${t.code}`}
        type="checkbox"
        className="ep-check__input"
        checked={on.has(t.code)}
        disabled={readOnly}
        onChange={(e) => set([t.code], e.target.checked)}
      />
      <span className="ep-check__box" aria-hidden="true" />
      <span className="ep-check__text">
        {t.label}
        {t.requiresMfa ? ' (OTP)' : ''}
        {explain ? <span className="ep-field__help">{t.description}</span> : null}
      </span>
    </label>
  );

  return (
    <div>
      {[...on].map((c) => (
        <input key={c} type="hidden" name="permissions" value={c} />
      ))}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <label className="ep-field" htmlFor="perm-search" style={{ flex: '1 1 16rem', margin: 0 }}>
          <span className="ep-field__label">Find a feature</span>
          <input
            id="perm-search"
            className="ep-input"
            type="search"
            value={q}
            placeholder="e.g. receipt, gate pass, attendance"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="ep-check" htmlFor="perm-only">
          <input
            id="perm-only"
            type="checkbox"
            className="ep-check__input"
            checked={onlyTicked}
            onChange={(e) => setOnlyTicked(e.target.checked)}
          />
          <span className="ep-check__box" aria-hidden="true" />
          <span className="ep-check__text">Show only what this role has</span>
        </label>
        <label className="ep-check" htmlFor="perm-explain">
          <input
            id="perm-explain"
            type="checkbox"
            className="ep-check__input"
            checked={explain}
            onChange={(e) => setExplain(e.target.checked)}
          />
          <span className="ep-check__box" aria-hidden="true" />
          <span className="ep-check__text">Explain each tick</span>
        </label>
        <strong role="status">
          {on.size} of {permissions.length} rights given
        </strong>
      </div>
      <p className="ep-field__help">
        (OTP) = asks for the second sign-in step when used. Hover a tick to read what it allows.
      </p>
      {shown.length === 0 ? <p>No feature matches.</p> : null}
      {shown.map(({ m, rows }) => {
        const isOpen = open.has(m.key) || needle !== '' || onlyTicked;
        const count = m.codes.filter((c) => on.has(c)).length;
        const viewCodes = columnCodes(m, 'view');
        return (
          <section key={m.key} className="ep-card" style={{ marginBottom: 'var(--sp-3)' }}>
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                aria-expanded={isOpen}
                aria-controls={`mod-${m.key}`}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(m.key)) next.delete(m.key);
                    else next.add(m.key);
                    return next;
                  })
                }
              >
                {isOpen ? '▾' : '▸'} {m.label}
              </button>
              <span
                className={`ep-badge ep-badge--${count === 0 ? 'neutral' : count === m.codes.length ? 'success' : 'info'}`}
              >
                {count === 0
                  ? 'No access'
                  : count === m.codes.length
                    ? 'Full access'
                    : `${count} of ${m.codes.length}`}
              </span>
              {readOnly ? null : (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => set(m.codes, true)}
                  >
                    Full access
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    onClick={() => {
                      set(m.codes, false);
                      set(viewCodes, true);
                    }}
                  >
                    View only
                  </button>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => set(m.codes, false)}
                  >
                    No access
                  </button>
                </span>
              )}
            </div>
            {isOpen ? (
              <div className="ep-table-wrap" id={`mod-${m.key}`}>
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">{m.label}: rights by feature</caption>
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      {MATRIX_COLUMNS.map((c) => {
                        const codes = columnCodes(m, c.key);
                        return (
                          <th key={c.key} scope="col" title={c.help}>
                            {readOnly || codes.length === 0 ? (
                              c.label
                            ) : (
                              <label className="ep-check" htmlFor={`col-${m.key}-${c.key}`}>
                                <input
                                  id={`col-${m.key}-${c.key}`}
                                  type="checkbox"
                                  className="ep-check__input"
                                  checked={all(codes)}
                                  onChange={(e) => set(codes, e.target.checked)}
                                />
                                <span className="ep-check__box" aria-hidden="true" />
                                <span className="ep-check__text">{c.label}</span>
                              </label>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          {readOnly ? (
                            r.label
                          ) : (
                            <label className="ep-check" htmlFor={`row-${r.key}`}>
                              <input
                                id={`row-${r.key}`}
                                type="checkbox"
                                className="ep-check__input"
                                checked={all(r.codes)}
                                onChange={(e) => set(r.codes, e.target.checked)}
                              />
                              <span className="ep-check__box" aria-hidden="true" />
                              <span className="ep-check__text">{r.label}</span>
                            </label>
                          )}
                        </td>
                        {MATRIX_COLUMNS.map((c) => (
                          <td key={c.key}>
                            {r.cells[c.key].length === 0 ? (
                              <span aria-hidden="true">·</span>
                            ) : (
                              <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
                                {r.cells[c.key].map(tick)}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
