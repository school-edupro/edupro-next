'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { saveAcrAssessors } from '@/lib/acr-actions';
import type { AcrAssessorRow, AcrAssessors } from '@/lib/acr';

type Staff = { id: string; name: string; code: string };
const label = (s: Staff | { name: string; code: string } | null | undefined) =>
  s ? `${s.name} (${s.code})` : '';
/** "Name (CODE)" from the picker, a bare code, or an id → what the API resolves (the code or the id). */
const refOf = (text: string) => {
  const t = text.trim();
  if (!t) return null;
  return /\(([^()]+)\)\s*$/.exec(t)?.[1]?.trim() ?? t;
};

/**
 * Who assesses each employee (0189, docs/design/32-employee-acr.md): every active employee in one list
 * with a searchable picker per employee-wise level (HOD, reviewer, …), filters, "set for the shown rows",
 * a missing count, Save, and a CSV to download, fill in Excel and upload (as the earlier ERP's ACR Master).
 * The pickers write the same record fields the ACR levels read.
 */
export function AcrAssessorsEditor({
  data,
  staff,
  canEdit,
  importAction,
}: {
  data: AcrAssessors;
  staff: Staff[];
  canEdit: boolean;
  importAction: (fd: FormData) => Promise<void>;
}) {
  // the text in each picker, by employee id and column key
  const initial = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const r of data.rows) {
      m[r.id] = {};
      for (const c of data.columns) m[r.id]![c.key] = label(r.assessors[c.key]);
    }
    return m;
  }, [data]);
  const [text, setText] = useState(initial);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [group, setGroup] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  const shown = data.rows.filter(
    (r) =>
      (!q ||
        r.name.toLowerCase().includes(q.toLowerCase()) ||
        r.code.toLowerCase().includes(q.toLowerCase())) &&
      (!department || (r.department ?? '') === department) &&
      (!group || r.staffGroup === group) &&
      (!missingOnly || r.missing),
  );
  const changed = data.rows.filter((r) =>
    data.columns.some((c) => (text[r.id]?.[c.key] ?? '') !== (initial[r.id]?.[c.key] ?? '')),
  );
  const setCell = (rowId: string, key: string, value: string) =>
    setText((t) => ({ ...t, [rowId]: { ...t[rowId], [key]: value } }));
  const applyBulk = (key: string) => {
    const value = bulk[key] ?? '';
    setText((t) => {
      const n = { ...t };
      for (const r of shown) n[r.id] = { ...n[r.id], [key]: value };
      return n;
    });
  };
  const save = () =>
    start(async () => {
      const rows = changed.map((r) => ({
        employee: r.code,
        assessors: Object.fromEntries(
          data.columns
            .filter((c) => (text[r.id]?.[c.key] ?? '') !== (initial[r.id]?.[c.key] ?? ''))
            .map((c) => [c.key, refOf(text[r.id]?.[c.key] ?? '')]),
        ),
      }));
      const r = await saveAcrAssessors(rows);
      if (!r.ok) return setMsg({ tone: 'danger', text: r.error });
      // the counts and the "nobody" marks come from the server: read them again
      router.refresh();
      setMsg({
        tone: r.errors.length ? 'info' : 'success',
        text: `${String(r.changed)} employees updated.${
          r.errors.length
            ? ` Not taken: ${r.errors.map((e) => `${e.employee} (${e.message})`).join('; ')}`
            : ''
        }`,
      });
    });
  const download = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = ['employee_code', 'name', 'department', ...data.columns.map((c) => c.key)];
    const lines = [
      head.join(','),
      ...data.rows.map((r) =>
        [
          r.code,
          r.name,
          r.department ?? '',
          ...data.columns.map((c) => r.assessors[c.key]?.code ?? ''),
        ]
          .map(esc)
          .join(','),
      ),
    ];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'acr-assessors.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const cellOf = (r: AcrAssessorRow, key: string) => text[r.id]?.[key] ?? '';

  return (
    <section
      className="ep-card"
      aria-labelledby="acr-assessors-h"
      style={{ padding: 'var(--sp-4)' }}
    >
      <h2 id="acr-assessors-h" className="ep-card__title">
        Who assesses each employee
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The levels marked “the employee’s …” read these people from each record. Type a name or
        code; a reviewer left empty falls back to{' '}
        {data.columns.find((c) => c.fallback)?.fallback ?? 'the designation set on the level'}.
      </p>
      <div className="ep-stat-row" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className={`ep-badge ep-badge--${data.missing ? 'warning' : 'success'}`}>
          {data.missing
            ? `${String(data.missing)} of ${String(data.total)} employees have nobody on a level`
            : `All ${String(data.total)} employees have their assessors`}
        </span>
      </div>
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {msg.text}
        </div>
      ) : null}
      <datalist id="acr-staff-list">
        {staff.map((s) => (
          <option key={s.id} value={label(s)} />
        ))}
      </datalist>
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-3)' }}>
        <label className="ep-field" htmlFor="as-q">
          <span className="ep-field__label">Name or code</span>
          <input id="as-q" className="ep-input" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="ep-field" htmlFor="as-dept">
          <span className="ep-field__label">Department</span>
          <select
            id="as-dept"
            className="ep-select"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All</option>
            {data.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="as-group">
          <span className="ep-field__label">Staff</span>
          <select
            id="as-group"
            className="ep-select"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="">All</option>
            <option value="teaching">Teaching</option>
            <option value="non_teaching">Non-teaching</option>
          </select>
        </label>
        <label className="ep-check" style={{ alignSelf: 'center' }}>
          <input
            type="checkbox"
            className="ep-check__input"
            checked={missingOnly}
            onChange={(e) => setMissingOnly(e.target.checked)}
          />
          <span className="ep-check__box" aria-hidden="true" />
          <span className="ep-check__text">Only those with nobody</span>
        </label>
      </div>
      <div className="ep-table-wrap">
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Assessors by employee</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {data.columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                  {c.fallback ? (
                    <span className="ep-field__help"> · empty = {c.fallback} by designation</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {canEdit && shown.length ? (
              <tr>
                <th scope="row">
                  <span className="ep-field__help">Set for the {String(shown.length)} shown</span>
                </th>
                {data.columns.map((c) => (
                  <td key={c.key}>
                    <span style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                      <input
                        className="ep-input"
                        list="acr-staff-list"
                        aria-label={`${c.label}: set for the shown rows`}
                        value={bulk[c.key] ?? ''}
                        onChange={(e) => setBulk((b) => ({ ...b, [c.key]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        onClick={() => applyBulk(c.key)}
                      >
                        Apply
                      </button>
                    </span>
                  </td>
                ))}
              </tr>
            ) : null}
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <div className="ep-field__help">
                    {[r.code, r.designation, r.department].filter(Boolean).join(' · ')}
                    {r.missing ? (
                      <span
                        className="ep-badge ep-badge--warning"
                        style={{ marginLeft: 'var(--sp-1)' }}
                      >
                        nobody
                      </span>
                    ) : null}
                  </div>
                </td>
                {data.columns.map((c) => (
                  <td key={c.key}>
                    {canEdit ? (
                      <input
                        className="ep-input"
                        list="acr-staff-list"
                        aria-label={`${c.label} of ${r.name}`}
                        value={cellOf(r, c.key)}
                        onChange={(e) => setCell(r.id, c.key, e.target.value)}
                      />
                    ) : (
                      cellOf(r, c.key) || '—'
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={data.columns.length + 1} className="ep-field__help">
                  Nobody matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 'var(--sp-3)',
        }}
      >
        {canEdit ? (
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            disabled={pending || !changed.length}
            onClick={save}
          >
            {pending ? 'Saving…' : `Save (${String(changed.length)} changed)`}
          </button>
        ) : null}
        <button type="button" className="ep-btn ep-btn--secondary" onClick={download}>
          Download CSV
        </button>
        {canEdit ? (
          <form
            action={importAction}
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
          >
            <label className="ep-field" htmlFor="as-file" style={{ margin: 0 }}>
              <span className="ep-sr-only">CSV to upload</span>
              <input id="as-file" name="file" type="file" accept=".csv,text/csv" required />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Upload CSV
            </button>
          </form>
        ) : null}
      </div>
      <p className="ep-field__help" style={{ marginBottom: 0 }}>
        The CSV has employee_code and a column per level with the assessor’s employee code. Fill it
        in Excel, save as CSV and upload; an empty cell clears that assessor.
      </p>
    </section>
  );
}
