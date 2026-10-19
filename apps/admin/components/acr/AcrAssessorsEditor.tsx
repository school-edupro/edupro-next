'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { saveAcrAssessors } from '@/lib/acr-actions';
import type { AcrAssessorLevel, AcrAssessorRow, AcrAssessors } from '@/lib/acr';

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
 * Who assesses each employee (0189/0190, docs/design/32-employee-acr.md): every active employee in one
 * list with a column per level of their group's chain (as many levels as the school set): a searchable
 * picker where the level reads the record, the fixed people otherwise; filters, "set for the shown
 * rows", a missing count, Save, and a CSV to download, fill in Excel and upload (as the earlier ERP's
 * ACR Master). The pickers write the record fields the levels read. A person on two levels in a row
 * assesses once: the second of them is skipped on the ACR.
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
  // the text in each picker, by employee id and record field
  const initial = useMemo(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const r of data.rows) {
      m[r.id] = {};
      for (const f of data.fields) m[r.id]![f.key] = label(r.assessors[f.key]);
    }
    return m;
  }, [data]);
  const [text, setText] = useState(initial);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [group, setGroup] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [bulk, setBulk] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  const seqs = Array.from({ length: data.maxSeq }, (_, i) => i + 1);
  const levelAt = (r: AcrAssessorRow, seq: number): AcrAssessorLevel | undefined =>
    data.levels[r.staffGroup].find((l) => l.seq === seq);
  const headerOf = (seq: number) => {
    const labels = [
      ...new Set(
        (['teaching', 'non_teaching'] as const)
          .map((g) => data.levels[g].find((l) => l.seq === seq)?.label)
          .filter((x): x is string => !!x),
      ),
    ];
    return labels.join(' / ') || `Level ${String(seq)}`;
  };
  const shown = data.rows.filter(
    (r) =>
      (!q ||
        r.name.toLowerCase().includes(q.toLowerCase()) ||
        r.code.toLowerCase().includes(q.toLowerCase())) &&
      (!department || (r.department ?? '') === department) &&
      (!group || r.staffGroup === group) &&
      (!missingOnly || r.missing),
  );
  const changedFields = (r: AcrAssessorRow) =>
    data.fields.filter((f) => (text[r.id]?.[f.key] ?? '') !== (initial[r.id]?.[f.key] ?? ''));
  const changed = data.rows.filter((r) => changedFields(r).length > 0);
  const setCell = (rowId: string, key: string, value: string) =>
    setText((t) => ({ ...t, [rowId]: { ...t[rowId], [key]: value } }));
  const applyBulk = (seq: number) => {
    const value = bulk[seq] ?? '';
    setText((t) => {
      const n = { ...t };
      for (const r of shown) {
        const l = levelAt(r, seq);
        const earlier =
          l?.field && data.levels[r.staffGroup].some((x) => x.seq < seq && x.field === l.field);
        if (l?.field && !earlier) n[r.id] = { ...n[r.id], [l.field]: value };
      }
      return n;
    });
  };
  const save = () =>
    start(async () => {
      const rows = changed.map((r) => ({
        employee: r.code,
        assessors: Object.fromEntries(
          changedFields(r).map((f) => [f.key, refOf(text[r.id]?.[f.key] ?? '')]),
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
    const head = ['employee_code', 'name', 'department', ...data.fields.map((f) => f.key)];
    const lines = [
      head.join(','),
      ...data.rows.map((r) =>
        [
          r.code,
          r.name,
          r.department ?? '',
          ...data.fields.map((f) => r.assessors[f.key]?.code ?? ''),
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
  const cell = (r: AcrAssessorRow, seq: number) => {
    const l = levelAt(r, seq);
    if (!l) return <span className="ep-field__help">—</span>;
    if (!l.field) return <span className="ep-field__help">{l.fixed ?? '—'}</span>;
    // an earlier level of the chain reads the same record field: one picker, one person
    const earlier = data.levels[r.staffGroup].find((x) => x.seq < seq && x.field === l.field);
    if (earlier)
      return (
        <span className="ep-field__help">
          same as level {earlier.seq} ({earlier.label}); set another kind under Approval levels
        </span>
      );
    const value = text[r.id]?.[l.field] ?? '';
    if (!canEdit)
      return value || (l.fallback ? <span className="ep-field__help">{l.fallback}</span> : '—');
    return (
      <input
        className="ep-input"
        list="acr-staff-list"
        aria-label={`${l.label} of ${r.name}`}
        placeholder={l.fallback ? `${l.fallback} unless set` : ''}
        value={value}
        onChange={(e) => setCell(r.id, l.field!, e.target.value)}
      />
    );
  };

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
        One column per level of the chain (
        <a href="/people/acr/setup?tab=levels">Approval levels</a>: add as many as you need). A
        level marked “the employee’s …” reads the person set here; type a name or code. A person on
        two levels in a row assesses once; the second is skipped on that ACR.
      </p>
      <p style={{ marginBottom: 'var(--sp-3)' }}>
        <span className={`ep-badge ep-badge--${data.missing ? 'warning' : 'success'}`}>
          {data.missing
            ? `${String(data.missing)} of ${String(data.total)} employees have nobody on a level`
            : `All ${String(data.total)} employees have their assessors`}
        </span>
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
          <caption className="ep-sr-only">Assessors by employee and level</caption>
          <thead>
            <tr>
              <th scope="col">Employee</th>
              {seqs.map((seq) => (
                <th key={seq} scope="col">
                  {seq}. {headerOf(seq)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {canEdit && shown.length ? (
              <tr>
                <td>
                  <span className="ep-field__help">Set for the {String(shown.length)} shown</span>
                </td>
                {seqs.map((seq) => (
                  <td key={seq}>
                    {shown.some((r) => levelAt(r, seq)?.field) ? (
                      <span style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                        <input
                          className="ep-input"
                          list="acr-staff-list"
                          aria-label={`${headerOf(seq)}: set for the shown rows`}
                          value={bulk[seq] ?? ''}
                          onChange={(e) => setBulk((b) => ({ ...b, [seq]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          onClick={() => applyBulk(seq)}
                        >
                          Apply
                        </button>
                      </span>
                    ) : null}
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
                {seqs.map((seq) => (
                  <td key={seq}>{cell(r, seq)}</td>
                ))}
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={seqs.length + 1} className="ep-field__help">
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
        The CSV has employee_code and a column per record field (
        {data.fields.map((f) => `${f.key} = ${f.label}`).join(', ')}) holding the assessor’s
        employee code. Fill it in Excel, save as CSV and upload; an empty cell clears that assessor.
      </p>
    </section>
  );
}
