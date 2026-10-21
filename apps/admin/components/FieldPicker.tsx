'use client';
import { Drawer } from '@edupro/ui';
import { useMemo, useRef, useState, useTransition } from 'react';

/** What a report's picker shows (the candidates' export, the library's book list). */
export interface PickerSetup {
  groups: Array<{
    id: string;
    title: string;
    columns: Array<{ key: string; label: string }>;
    /** the rows this group's fields fit (none: every kind) */
    levels?: string[];
  }>;
  sheets: Array<{ kind: string; title: string }>;
  /** every field, in the order of the full export */
  full: string[];
  fullByLevel?: Record<string, string[]>;
  /** what one row of the file is (a copy or a title); none: one kind only */
  levels?: Array<{ value: string; label: string }>;
  layouts: Array<{
    id: string;
    name: string;
    columns: string[];
    sheets: string[];
    level?: string;
    by: string | null;
    updatedAt: string;
    canEdit: boolean;
  }>;
  last: { columns: string[]; sheets: string[]; level?: string } | null;
}
type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * A report's Excel export with the fields people pick (docs/design/34-recruitment.md part 10; 36-library
 * part 3): what one row is (when the report has more than one kind), start from my last choice, every
 * field or a layout the school keeps; tick fields by group (with a search), arrange them in the order
 * wanted, tick the lists that come as sheets of their own; save the choice as a named layout; download
 * the list as filtered (or only the ticked rows, where the list has ticks).
 */
export function FieldPicker({
  noun,
  filters,
  count,
  countByLevel,
  startLevel,
  action,
  load,
  save: saveLayout,
  remove: removeLayout,
  ticked: canTick = false,
  example = 'For example: Shelf list',
  sheetsHelp,
}: {
  /** what the rows are, for the people reading: Candidates, Books */
  noun: string;
  /** the list's filters, as the download sends them */
  filters: Record<string, string>;
  /** how many rows the list has (left out when the list does not say) */
  count?: number;
  countByLevel?: Record<string, number>;
  /** the row kind it opens on (the list on screen) when no choice says otherwise */
  startLevel?: string;
  /** where the choice is posted for the file */
  action: string;
  load: () => Promise<PickerSetup>;
  save: (input: {
    name: string;
    columns: string[];
    sheets: string[];
    level?: string;
  }) => Promise<Result<{ id: string; updated: boolean }>>;
  remove: (id: string) => Promise<Result<object>>;
  /** the list has ticks (input name="ids"): only the ticked can be taken */
  ticked?: boolean;
  example?: string;
  sheetsHelp?: string;
}) {
  const loadExportSetup = load;
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<PickerSetup | null>(null);
  const [level, setLevel] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [sheets, setSheets] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [scope, setScope] = useState<'filtered' | 'ticked'>('filtered');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  const label = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of setup?.groups ?? []) for (const c of g.columns) m.set(c.key, c.label);
    return m;
  }, [setup]);
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of setup?.groups ?? []) for (const c of g.columns) m.set(c.key, g.title);
    return m;
  }, [setup]);
  const layout = setup?.layouts.find((l) => l.id === from) ?? null;
  // the layout's name goes on the file only while its fields are as saved
  const asSaved =
    layout !== null &&
    (layout.level ?? '') === level &&
    layout.columns.join('|') === chosen.join('|') &&
    [...layout.sheets].sort().join('|') === [...sheets].sort().join('|');
  /** the groups, and so the fields, a kind of row has */
  const groupsFor = (s: PickerSetup, lv: string) =>
    s.groups.filter((g) => !g.levels || !lv || g.levels.includes(lv));
  const allowedFor = (s: PickerSetup, lv: string) =>
    new Set(groupsFor(s, lv).flatMap((g) => g.columns.map((c) => c.key)));
  const changeLevel = (s: PickerSetup, lv: string) => {
    const ok = allowedFor(s, lv);
    setLevel(lv);
    // "every field" stays every field of the new kind of row; a choice keeps what still fits
    if (from === 'all') setChosen((s.fullByLevel?.[lv] ?? s.full).filter((k) => ok.has(k)));
    else setChosen((cur) => cur.filter((k) => ok.has(k)));
  };

  const apply = (s: PickerSetup, pick: string) => {
    setFrom(pick);
    setMsg(null);
    const lvOf = (x?: string) =>
      x ?? (s.levels?.length ? level || startLevel || s.levels[0]!.value : '');
    const take = (cols: string[], lv: string) => {
      const ok = allowedFor(s, lv);
      setLevel(lv);
      setChosen(cols.filter((k) => ok.has(k)));
    };
    if (pick === 'last' && s.last) {
      take(s.last.columns, lvOf(s.last.level));
      setSheets(s.last.sheets);
    } else if (pick === 'all') {
      const lv = lvOf();
      take(s.fullByLevel?.[lv] ?? s.full, lv);
      setSheets(s.sheets.map((x) => x.kind));
    } else if (pick === 'none') {
      setLevel(lvOf());
      setChosen([]);
      setSheets([]);
    } else {
      const l = s.layouts.find((x) => x.id === pick);
      if (l) {
        take(l.columns, lvOf(l.level));
        setSheets(l.sheets);
        setName(l.name);
      }
    }
  };
  const show = () => {
    setOpen(true);
    // the candidates ticked on the list, if any
    const ids = canTick
      ? Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')).map(
          (x) => x.value,
        )
      : [];
    setTicked(ids);
    setScope(ids.length ? 'ticked' : 'filtered');
    if (!setup)
      start(async () => {
        try {
          const s = await loadExportSetup();
          setSetup(s);
          apply(s, s.last ? 'last' : 'all');
        } catch {
          setMsg({ tone: 'danger', text: 'The fields could not be loaded. Try again.' });
        }
      });
  };
  const toggle = (key: string, on: boolean) =>
    setChosen((cur) =>
      on ? (cur.includes(key) ? cur : [...cur, key]) : cur.filter((k) => k !== key),
    );
  const move = (i: number, d: -1 | 1) =>
    setChosen((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const needle = q.trim().toLowerCase();
  const save = () =>
    start(async () => {
      const r = await saveLayout({
        name: name.trim(),
        columns: chosen,
        sheets,
        ...(level ? { level } : {}),
      });
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      const s = await loadExportSetup();
      setSetup(s);
      setFrom(r.id);
      setMsg({
        tone: 'success',
        text: r.updated ? `Layout “${name.trim()}” changed.` : `Saved as “${name.trim()}”.`,
      });
    });
  const remove = () => {
    if (!layout) return;
    start(async () => {
      const r = await removeLayout(layout.id);
      if (!r.ok) {
        setMsg({ tone: 'danger', text: r.error });
        return;
      }
      const s = await loadExportSetup();
      setSetup(s);
      setFrom('');
      setName('');
      setMsg({ tone: 'success', text: `Layout “${layout.name}” removed.` });
    });
  };
  const download = () => {
    if (!chosen.length) return;
    form.current?.requestSubmit();
    // the API keeps this as my last choice
    setSetup((s) =>
      s ? { ...s, last: { columns: chosen, sheets, ...(level ? { level } : {}) } } : s,
    );
  };

  return (
    <>
      <button type="button" className="ep-btn ep-btn--secondary" onClick={show}>
        Customise export
      </button>
      <Drawer
        open={open}
        title="Customise the Excel export"
        onClose={() => setOpen(false)}
        width="lg"
        footer={
          <div className="ep-xp__footer">
            <label className="ep-field" htmlFor="xp-name" style={{ margin: 0 }}>
              <span className="ep-field__label">Save as a layout</span>
              <span className="ep-xp__save">
                <input
                  id="xp-name"
                  className="ep-input"
                  maxLength={60}
                  placeholder={example}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost"
                  disabled={pending || name.trim().length < 2 || !chosen.length}
                  onClick={save}
                >
                  Save layout
                </button>
              </span>
            </label>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={!chosen.length || !setup}
              onClick={download}
            >
              Download Excel
              {(() => {
                const n = scope === 'ticked' ? ticked.length : (countByLevel?.[level] ?? count);
                return n === undefined ? '' : ` (${String(n)})`;
              })()}
            </button>
          </div>
        }
      >
        {msg ? (
          <p className={`ep-alert ep-alert--${msg.tone}`} role="status">
            {msg.text}
          </p>
        ) : null}
        {!setup ? (
          <p className="ep-field__help">{pending ? 'Loading the fields…' : ''}</p>
        ) : (
          <>
            <div className="ep-xp__top">
              {setup.levels?.length ? (
                <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="ep-field__label">One row is</legend>
                  {setup.levels.map((lv) => (
                    <label key={lv.value} className="ep-check" htmlFor={`xp-level-${lv.value}`}>
                      <input
                        id={`xp-level-${lv.value}`}
                        type="radio"
                        name="xp-level"
                        checked={level === lv.value}
                        onChange={() => changeLevel(setup, lv.value)}
                      />{' '}
                      {lv.label}
                      {countByLevel?.[lv.value] !== undefined
                        ? ` (${String(countByLevel[lv.value])})`
                        : ''}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ep-field__label">{noun}</legend>
                <label className="ep-check" htmlFor="xp-scope-f">
                  <input
                    id="xp-scope-f"
                    type="radio"
                    name="xp-scope"
                    checked={scope === 'filtered'}
                    onChange={() => setScope('filtered')}
                  />{' '}
                  As the list is filtered
                  {setup.levels?.length || count === undefined ? '' : ` (${String(count)})`}
                </label>
                {canTick ? (
                  <label className="ep-check" htmlFor="xp-scope-t">
                    <input
                      id="xp-scope-t"
                      type="radio"
                      name="xp-scope"
                      checked={scope === 'ticked'}
                      disabled={!ticked.length}
                      onChange={() => setScope('ticked')}
                    />{' '}
                    Only the ticked ({ticked.length})
                  </label>
                ) : null}
              </fieldset>
              <label className="ep-field" htmlFor="xp-from" style={{ margin: 0 }}>
                <span className="ep-field__label">Start from</span>
                <select
                  id="xp-from"
                  className="ep-select"
                  value={from}
                  onChange={(e) => apply(setup, e.target.value)}
                >
                  <option value="" disabled>
                    Choose
                  </option>
                  {setup.last ? <option value="last">My last choice</option> : null}
                  <option value="all">Every field</option>
                  <option value="none">Nothing (pick from scratch)</option>
                  {setup.layouts.length ? (
                    <optgroup label="The school’s layouts">
                      {setup.layouts.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                          {l.by ? ` (${l.by})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              {layout?.canEdit ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  disabled={pending}
                  onClick={remove}
                >
                  Remove this layout
                </button>
              ) : null}
            </div>

            <div className="ep-xp">
              <section aria-labelledby="xp-fields-h">
                <h4 id="xp-fields-h" className="ep-field__label">
                  Fields
                </h4>
                <label className="ep-sr-only" htmlFor="xp-q">
                  Find a field
                </label>
                <input
                  id="xp-q"
                  type="search"
                  className="ep-input"
                  placeholder="Find a field"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                {groupsFor(setup, level).map((g) => {
                  const cols = g.columns.filter(
                    (c) => !needle || c.label.toLowerCase().includes(needle),
                  );
                  if (!cols.length) return null;
                  const all = cols.every((c) => chosen.includes(c.key));
                  return (
                    <fieldset key={g.id} className="ep-xp__group">
                      <legend className="ep-xp__legend">
                        {g.title}
                        <button
                          type="button"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                          aria-label={`${all ? 'Untick' : 'Tick'} every field of ${g.title}`}
                          onClick={() =>
                            setChosen((cur) =>
                              all
                                ? cur.filter((k) => !cols.some((c) => c.key === k))
                                : [
                                    ...cur,
                                    ...cols.map((c) => c.key).filter((k) => !cur.includes(k)),
                                  ],
                            )
                          }
                        >
                          {all ? 'None' : 'All'}
                        </button>
                      </legend>
                      {cols.map((c) => (
                        <label key={c.key} className="ep-check" htmlFor={`xp-${c.key}`}>
                          <input
                            id={`xp-${c.key}`}
                            type="checkbox"
                            checked={chosen.includes(c.key)}
                            onChange={(e) => toggle(c.key, e.target.checked)}
                          />{' '}
                          {c.label}
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </section>

              <section aria-labelledby="xp-order-h">
                <h4 id="xp-order-h" className="ep-field__label">
                  Columns in the file ({chosen.length})
                </h4>
                {chosen.length ? (
                  <ol className="ep-xp__order">
                    {chosen.map((k, i) => (
                      <li key={k}>
                        <span>
                          <span className="ep-xp__n">{i + 1}.</span>
                          {label.get(k) ?? k}
                          <span className="ep-field__help"> · {groupOf.get(k)}</span>
                        </span>
                        <span className="ep-xp__moves">
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Move ${label.get(k) ?? k} up`}
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Move ${label.get(k) ?? k} down`}
                            disabled={i === chosen.length - 1}
                            onClick={() => move(i, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Leave out ${label.get(k) ?? k}`}
                            onClick={() => toggle(k, false)}
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="ep-field__help">Tick the fields to put in the file.</p>
                )}
                {setup.sheets.length ? (
                  <fieldset className="ep-xp__group">
                    <legend className="ep-xp__legend">Also a sheet of its own for</legend>
                    {setup.sheets.map((s) => (
                      <label key={s.kind} className="ep-check" htmlFor={`xp-sheet-${s.kind}`}>
                        <input
                          id={`xp-sheet-${s.kind}`}
                          type="checkbox"
                          checked={sheets.includes(s.kind)}
                          onChange={(e) =>
                            setSheets((cur) =>
                              e.target.checked ? [...cur, s.kind] : cur.filter((x) => x !== s.kind),
                            )
                          }
                        />{' '}
                        {s.title}
                      </label>
                    ))}
                    {sheetsHelp ? (
                      <p className="ep-field__help" style={{ margin: 0 }}>
                        {sheetsHelp}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}
              </section>
            </div>
          </>
        )}
        <form ref={form} method="post" action={action} hidden>
          {scope === 'ticked'
            ? ticked.map((id) => <input key={id} type="hidden" name="ids" value={id} />)
            : Object.entries(filters).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
          {chosen.map((k) => (
            <input key={k} type="hidden" name="columns" value={k} />
          ))}
          {sheets.map((k) => (
            <input key={k} type="hidden" name="sheets" value={k} />
          ))}
          {level ? <input type="hidden" name="level" value={level} /> : null}
          {asSaved ? <input type="hidden" name="layout" value={layout.name} /> : null}
        </form>
      </Drawer>
    </>
  );
}
