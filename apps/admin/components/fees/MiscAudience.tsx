'use client';

import { useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import type { MiscResult, MiscSheetRow } from '@/lib/misc-fee-actions';

export interface MiscAudienceValue {
  classIds: string[];
  sectionIds: string[];
  studentIds: string[];
  rows: MiscSheetRow[];
}
export const EMPTY_AUDIENCE: MiscAudienceValue = {
  classIds: [],
  sectionIds: [],
  studentIds: [],
  rows: [],
};
type Found = { id: string; name: string; admissionNo: string; section: string | null };

/**
 * Who a misc fee is for: whole classes, sections, pupils found by name, or the rows of an Excel sheet
 * (admission number, and where it differs, the pupil's own amount and last date). The four add up.
 */
export function MiscAudience({
  classes,
  sections,
  value,
  onChange,
  findPupils,
  readSheet,
}: {
  classes: Array<{ value: string; label: string }>;
  sections: Array<{ value: string; label: string }>;
  value: MiscAudienceValue;
  onChange: (next: MiscAudienceValue) => void;
  findPupils: (q: string) => Promise<MiscResult<Found[]>>;
  readSheet: (base64: string) => Promise<MiscResult<{ rows: MiscSheetRow[]; errors: string[] }>>;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found[]>([]);
  const [note, setNote] = useState('');
  const [sheetErrors, setSheetErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    const r = await findPupils(q.trim());
    setBusy(false);
    if (!r.ok) return setNote(r.error);
    setFound(r.data);
    setNote(r.data.length ? '' : 'Nobody found by that name or admission number');
  };
  const pick = (f: Found) => {
    if (picked.some((x) => x.id === f.id)) return;
    const next = [...picked, f];
    setPicked(next);
    onChange({ ...value, studentIds: next.map((x) => x.id) });
  };
  const drop = (id: string) => {
    const next = picked.filter((x) => x.id !== id);
    setPicked(next);
    onChange({ ...value, studentIds: next.map((x) => x.id) });
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await readSheet(btoa(bin));
    setBusy(false);
    if (!r.ok) {
      setSheetErrors([r.error]);
      return onChange({ ...value, rows: [] });
    }
    setSheetErrors(r.data.errors);
    onChange({ ...value, rows: r.data.errors.length ? [] : r.data.rows });
  };
  const own = value.rows.filter((r) => r.amount !== undefined || r.lastDate).length;

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <ChipPicker
        label="Whole classes"
        options={classes}
        value={value.classIds}
        onChange={(classIds) => onChange({ ...value, classIds })}
        help="Every active pupil of each class chosen, all its sections."
      />
      <ChipPicker
        label="Sections"
        options={sections}
        value={value.sectionIds}
        onChange={(sectionIds) => onChange({ ...value, sectionIds })}
        help="Every active pupil of each section chosen."
      />
      <div>
        <label className="ep-field" htmlFor="misc-find" style={{ margin: 0 }}>
          <span className="ep-field__label">Pupils by name</span>
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <input
              id="misc-find"
              className="ep-input"
              value={q}
              maxLength={60}
              placeholder="Name or admission number"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
            />
            <button
              type="button"
              className="ep-btn ep-btn--secondary"
              disabled={busy}
              onClick={() => void search()}
            >
              Find
            </button>
          </span>
        </label>
        {note ? <p className="ep-field__help">{note}</p> : null}
        {found.length ? (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 'var(--sp-2) 0 0',
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
            }}
          >
            {found
              .filter((f) => !picked.some((x) => x.id === f.id))
              .slice(0, 20)
              .map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    onClick={() => pick(f)}
                  >
                    + {f.name} · {f.admissionNo}
                    {f.section ? ` · ${f.section}` : ''}
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
        {picked.length ? (
          <ul
            aria-label="Pupils chosen"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 'var(--sp-2) 0 0',
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
            }}
          >
            {picked.map((f) => (
              <li key={f.id} className="ep-badge">
                {f.name} · {f.admissionNo}{' '}
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => drop(f.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div>
        <label className="ep-field" htmlFor="misc-sheet" style={{ margin: 0 }}>
          <span className="ep-field__label">Excel sheet</span>
          <input
            id="misc-sheet"
            type="file"
            className="ep-input"
            accept=".xlsx"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
        <p className="ep-field__help">
          Columns: admission number, amount, last date. Leave amount or date empty to use the fee’s
          own; fill them to give a pupil a different amount or date.{' '}
          <a href="/api/fees/misc-sheet" style={{ textDecoration: 'underline' }}>
            Download the format
          </a>
        </p>
        {sheetErrors.length ? (
          <ul className="ep-field__error" role="alert">
            {sheetErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : value.rows.length ? (
          <p role="status" style={{ margin: 0 }}>
            <strong>{value.rows.length} pupil(s) read</strong>
            {own ? `, ${String(own)} with their own amount or last date` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
