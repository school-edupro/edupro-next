'use client';
import { useMemo, useState, useTransition } from 'react';
import {
  addLocalities,
  archiveScoreRow,
  importScoreSheet,
  qualificationsFromList,
  saveScoreRow,
} from '@/lib/admission-scores-actions';
import {
  TABLE_TITLE,
  type ScoreOptions,
  type ScoreRow,
  type ScoreTableName,
} from '@/lib/admission-scores';

const HELP: Record<ScoreTableName, string> = {
  qualification:
    "Each qualification of the school's Education list (the one the form asks) gives the father's score and the mother's score; an education criterion adds both. Weights are kept for later.",
  locality:
    'The family picks its locality on the form (from the Locality master below); the locality gives the distance points. A line for one class wins over the one for every class.',
  alumni_school:
    "The school a parent studied at and the class they passed out of, as the form asks it (the school's AlumniClass list, e.g. X, XII; X and 10 are the same) give the alumni points. A criterion adds the father's and the mother's up to its cap; when the form does not ask which school, the criterion names it.",
};

type Draft = Omit<ScoreRow, 'id' | 'className'>;
const empty = (t: ScoreTableName): Draft =>
  t === 'qualification'
    ? { name: '', fatherScore: 0, motherScore: 0, fatherWeight: 0, motherWeight: 0 }
    : t === 'locality'
      ? { name: '', classId: null, band: '', area: '', score: 0 }
      : { name: '', passoutClass: '', score: 0 };

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * One merit score table (docs/design/48, part 1): search, add, change, archive, and Excel out and in
 * (every row checked first; a row matching one in the table changes it).
 */
export function ScoreTablesEditor({
  table,
  initial,
  classes,
  options,
  canEdit,
}: {
  table: ScoreTableName;
  initial: ScoreRow[];
  classes: Array<{ id: string; name: string }>;
  /** the school's lists the names come from (Education, Locality, AlumniClass) */
  options: ScoreOptions;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [opts, setOpts] = useState(options);
  const [newPlaces, setNewPlaces] = useState('');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft>(empty(table));
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{
    tone: 'success' | 'danger';
    text: string;
    rows?: Array<{ row: number; message: string }>;
  } | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        `${r.name} ${r.className ?? ''} ${r.band ?? ''} ${r.passoutClass ?? ''}`
          .toLowerCase()
          .includes(q.trim().toLowerCase()),
      ),
    [rows, q],
  );
  const done = (
    r:
      | { ok: true; data: { rows: ScoreRow[] } }
      | { ok: false; error: string; rows?: Array<{ row: number; message: string }> },
    text: string,
  ) => {
    if (r.ok) {
      setRows(r.data.rows);
      setMsg({ tone: 'success', text });
      return true;
    }
    setMsg({ tone: 'danger', text: r.error, rows: r.rows });
    return false;
  };
  const add = () =>
    start(async () => {
      if (!draft.name?.trim()) return setMsg({ tone: 'danger', text: 'Choose the name first.' });
      const row =
        table === 'alumni_school' && !draft.passoutClass
          ? { ...draft, passoutClass: opts.passout[opts.passout.length - 1] ?? 'XII' }
          : draft;
      if (done(await saveScoreRow(table, null, row), `“${draft.name.trim()}” added.`))
        setDraft(empty(table));
    });
  const addPlaces = () =>
    start(async () => {
      const names = newPlaces
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!names.length) return;
      const r = await addLocalities(names);
      if (r.ok) {
        setOpts(r.data.options);
        setNewPlaces('');
        setMsg({
          tone: 'success',
          text: `${String(r.data.added)} localit${r.data.added === 1 ? 'y' : 'ies'} in the Locality list: choose each below and give its score.`,
        });
      } else setMsg({ tone: 'danger', text: r.error });
    });
  // the names a dropdown offers: the school's list, and the row's own name if the list lacks it
  const namesFor = (current: string) => {
    const list = table === 'qualification' ? opts.qualification : opts.locality;
    return current && !list.some((x) => x.toLowerCase() === current.toLowerCase())
      ? [current, ...list]
      : list;
  };
  const save = () =>
    start(async () => {
      if (!editing) return;
      if (done(await saveScoreRow(table, editing.id, editing.d), 'Saved.')) setEditing(null);
    });
  const archive = (r: ScoreRow) =>
    start(async () => {
      done(await archiveScoreRow(table, r.id), `“${r.name}” taken out of the table.`);
    });
  const upload = () =>
    start(async () => {
      if (!file) return;
      const r = await importScoreSheet(table, await base64(file));
      if (r.ok) {
        setRows(r.data.rows);
        setFile(null);
        setMsg({
          tone: 'success',
          text: `Sheet saved: ${String(r.data.added)} added, ${String(r.data.changed)} changed.`,
        });
      } else setMsg({ tone: 'danger', text: r.error, rows: r.rows });
    });
  const fromList = () =>
    start(async () => {
      const r = await qualificationsFromList();
      if (r.ok) {
        setRows(r.data.rows);
        setMsg({
          tone: 'success',
          text: r.data.added
            ? `${String(r.data.added)} qualifications added from the Education list with 0 points: fill their scores.`
            : 'Every qualification of the Education list is in the table already.',
        });
      } else setMsg({ tone: 'danger', text: r.error });
    });

  const fields = (d: Draft, set: (p: Partial<Draft>) => void, label: string) => {
    const n = (k: keyof Draft, title: string) => (
      <label className="ep-field" key={String(k)}>
        <span className="ep-field__label">{title}</span>
        <input
          className="ep-input"
          inputMode="decimal"
          aria-label={`${title}${label}`}
          value={String(d[k] ?? '')}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.-]/g, '');
            set({ [k]: t === '' || t === '-' ? 0 : Number(t) } as Partial<Draft>);
          }}
        />
      </label>
    );
    return (
      <>
        <label className="ep-field" style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <span className="ep-field__label">
            {table === 'qualification'
              ? 'Qualification'
              : table === 'locality'
                ? 'Locality'
                : 'School'}
          </span>
          {table === 'alumni_school' ? (
            <>
              <input
                className="ep-input"
                maxLength={120}
                aria-label={`Name${label}`}
                list={`st-schools${label.replace(/\W/g, '')}`}
                value={d.name}
                onChange={(e) => set({ name: e.target.value })}
              />
              <datalist id={`st-schools${label.replace(/\W/g, '')}`}>
                {opts.schools.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </>
          ) : (
            <select
              className="ep-select"
              aria-label={`Name${label}`}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            >
              <option value="">
                {table === 'qualification' ? 'Choose the qualification' : 'Choose the locality'}
              </option>
              {namesFor(d.name).map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
        </label>
        {table === 'qualification' ? (
          <>
            {n('fatherScore', 'Father score')}
            {n('motherScore', 'Mother score')}
            {n('fatherWeight', 'Father weight')}
            {n('motherWeight', 'Mother weight')}
          </>
        ) : table === 'locality' ? (
          <>
            <label className="ep-field">
              <span className="ep-field__label">Class</span>
              <select
                className="ep-select"
                aria-label={`Class${label}`}
                value={d.classId ?? ''}
                onChange={(e) => set({ classId: e.target.value || null })}
              >
                <option value="">Every class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Distance band</span>
              <input
                className="ep-input"
                maxLength={40}
                placeholder="8-15 km"
                aria-label={`Distance band${label}`}
                value={d.band ?? ''}
                onChange={(e) => set({ band: e.target.value })}
              />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Area</span>
              <input
                className="ep-input"
                maxLength={40}
                aria-label={`Area${label}`}
                value={d.area ?? ''}
                onChange={(e) => set({ area: e.target.value })}
              />
            </label>
            {n('score', 'Score')}
          </>
        ) : (
          <>
            <label className="ep-field">
              <span className="ep-field__label">Pass-out class</span>
              <select
                className="ep-select"
                aria-label={`Pass-out class${label}`}
                value={d.passoutClass || (opts.passout[opts.passout.length - 1] ?? '')}
                onChange={(e) => set({ passoutClass: e.target.value })}
              >
                {[
                  ...(d.passoutClass &&
                  !opts.passout.some((x) => x.toLowerCase() === d.passoutClass!.toLowerCase())
                    ? [d.passoutClass]
                    : []),
                  ...opts.passout,
                ].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {n('score', 'Score')}
          </>
        )}
      </>
    );
  };

  const cells = (r: ScoreRow) =>
    table === 'qualification'
      ? [r.fatherScore, r.motherScore, r.fatherWeight, r.motherWeight]
      : table === 'locality'
        ? [r.className ?? 'Every class', r.band ?? '', r.area ?? '', r.score]
        : [r.passoutClass, r.score];
  const heads =
    table === 'qualification'
      ? ['Father score', 'Mother score', 'Father weight', 'Mother weight']
      : table === 'locality'
        ? ['Class', 'Distance band', 'Area', 'Score']
        : ['Pass-out class', 'Score'];

  return (
    <section className="ep-card" aria-labelledby={`st-${table}`}>
      <h2 id={`st-${table}`} className="ep-card__title">
        {TABLE_TITLE[table]}
      </h2>
      <p className="ep-field__help">{HELP[table]}</p>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          margin: 'var(--sp-3) 0',
        }}
      >
        <label className="ep-field" style={{ margin: 0, flex: '1 1 220px' }}>
          <span className="ep-field__label">Search</span>
          <input className="ep-input" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/admissions/score-file?table=${table}&rows=1`}
        >
          Export Excel
        </a>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/admissions/score-file?table=${table}&format=pdf`}
        >
          Export PDF
        </a>
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/api/admissions/score-file?table=${table}`}
        >
          Sample Excel
        </a>
        {canEdit && table === 'qualification' ? (
          <button
            type="button"
            className="ep-btn ep-btn--secondary ep-btn--sm"
            disabled={pending}
            onClick={fromList}
          >
            Start from the Education list
          </button>
        ) : null}
      </div>
      {canEdit && table === 'locality' ? (
        <section
          className="ep-card"
          aria-labelledby="st-place-master"
          style={{ marginBottom: 'var(--sp-3)', background: 'var(--surface-subtle)' }}
        >
          <h3 id="st-place-master" className="ep-card__title">
            Locality master ({opts.locality.length})
          </h3>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The localities families choose from on the form and the table below. Add new ones here
            (one a line, or with commas); rename or switch off at{' '}
            <a href="/masters/system?tab=profile_lists">System setup → Profile lists</a> (list
            “Locality”). On the form, give the locality question the list “Locality”.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <label className="ep-field" style={{ margin: 0, flex: '1 1 320px' }}>
              <span className="ep-field__label">New localities</span>
              <textarea
                className="ep-input"
                rows={3}
                placeholder={'Sector 15\nSunder Vihar\nOld Faridabad'}
                value={newPlaces}
                onChange={(e) => setNewPlaces(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending || !newPlaces.trim()}
              onClick={addPlaces}
            >
              Add to the master
            </button>
          </div>
        </section>
      ) : null}
      {canEdit ? (
        <div style={{ display: 'grid', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
              gap: 'var(--sp-2)',
              alignItems: 'end',
            }}
          >
            {fields(draft, (p) => setDraft((d) => ({ ...d, ...p })), ' (new)')}
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={pending}
              onClick={add}
            >
              Add
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Upload the filled sheet (.xlsx)</span>
              <input
                className="ep-input"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              disabled={pending || !file}
              onClick={upload}
            >
              Upload
            </button>
          </div>
        </div>
      ) : null}
      {msg ? (
        <div
          className={`ep-alert ep-alert--${msg.tone}`}
          role={msg.tone === 'danger' ? 'alert' : 'status'}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {msg.text}
          {msg.rows?.length ? (
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {msg.rows.map((r) => (
                <li key={`${String(r.row)}-${r.message}`}>
                  Row {r.row}: {r.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="ep-field__help">
          Nothing in the table yet: add lines above or upload the Excel format filled.
        </p>
      ) : (
        <div className="ep-table-wrap">
          <table className="ep-table">
            <caption className="ep-sr-only">{TABLE_TITLE[table]}</caption>
            <thead>
              <tr>
                <th scope="col">
                  {table === 'qualification'
                    ? 'Qualification'
                    : table === 'locality'
                      ? 'Locality'
                      : 'School'}
                </th>
                {heads.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
                {canEdit ? (
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) =>
                editing?.id === r.id ? (
                  <tr key={r.id}>
                    <td colSpan={heads.length + 2}>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
                          gap: 'var(--sp-2)',
                          alignItems: 'end',
                        }}
                      >
                        {fields(
                          editing.d,
                          (p) => setEditing((x) => (x ? { ...x, d: { ...x.d, ...p } } : x)),
                          ` of ${r.name}`,
                        )}
                        <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                          <button
                            type="button"
                            className="ep-btn ep-btn--primary ep-btn--sm"
                            disabled={pending}
                            onClick={save}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    {cells(r).map((v, i) => (
                      <td key={i} className={typeof v === 'number' ? 'ep-num' : undefined}>
                        {v ?? ''}
                      </td>
                    ))}
                    {canEdit ? (
                      <td>
                        <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Change ${r.name}`}
                            onClick={() => {
                              setEditing({
                                id: r.id,
                                d: {
                                  name: r.name,
                                  fatherScore: r.fatherScore,
                                  motherScore: r.motherScore,
                                  fatherWeight: r.fatherWeight,
                                  motherWeight: r.motherWeight,
                                  classId: r.classId,
                                  band: r.band,
                                  area: r.area,
                                  passoutClass: r.passoutClass,
                                  score: r.score,
                                },
                              });
                            }}
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Take ${r.name} out of the table`}
                            disabled={pending}
                            onClick={() => archive(r)}
                          >
                            Remove
                          </button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="ep-field__help">
        {shown.length} of {rows.length} shown
      </p>
    </section>
  );
}
