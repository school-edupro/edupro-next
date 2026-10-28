'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** A candidate of the slot as the filters see it (docs/design/61, part 2). */
export interface SlotItem {
  id: string;
  /** name and registration no., lower case */
  text: string;
  roll: string;
  classId: string;
  stands: 'todecide' | 'held' | 'decided';
  marked: boolean;
  absent: boolean;
  below: boolean;
}
type Filters = {
  q: string;
  stands: '' | SlotItem['stands'];
  marks: '' | 'unmarked' | 'absent';
  below: boolean;
  cls: string;
};
const EMPTY: Filters = { q: '', stands: '', marks: '', below: false, cls: '' };
const STANDS: Array<[Filters['stands'], string]> = [
  ['', 'All'],
  ['todecide', 'To decide'],
  ['held', 'On hold'],
  ['decided', 'Decided'],
];
const MARKS: Array<[Filters['marks'], string]> = [
  ['', 'All'],
  ['unmarked', 'No marks yet'],
  ['absent', 'Absent'],
];

const Ctx = createContext<{
  f: Filters;
  set: (p: Partial<Filters>) => void;
  visible: Set<string>;
  items: SlotItem[];
  classes: Array<{ id: string; name: string }>;
} | null>(null);

/** The slot page's filter, when the list is inside one (the Test results page has none). */
export function useSlotFilter() {
  return useContext(Ctx);
}

const fromUrl = (): Filters => {
  if (typeof window === 'undefined') return EMPTY;
  const sp = new URLSearchParams(window.location.search);
  const stands = sp.get('stands');
  const marks = sp.get('marks');
  return {
    q: (sp.get('q') ?? '').slice(0, 80),
    stands: stands === 'todecide' || stands === 'held' || stands === 'decided' ? stands : '',
    marks: marks === 'unmarked' || marks === 'absent' ? marks : '',
    below: sp.get('below') === '1',
    cls: /^\d{1,18}$/.test(sp.get('cls') ?? '') ? sp.get('cls')! : '',
  };
};

/**
 * The slot's candidates filtered in the page (docs/design/61): a name, registration or roll no.,
 * where they stand, marks, below cut-off and class; kept in the address so a refresh keeps them.
 */
export function SlotFilterProvider({
  items,
  classes,
  children,
}: {
  items: SlotItem[];
  classes: Array<{ id: string; name: string }>;
  children: ReactNode;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  // read once in the browser (the server renders every row)
  useEffect(() => setF(fromUrl()), []);
  useEffect(() => {
    const u = new URL(window.location.href);
    const put = (k: string, v: string) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    put('q', f.q.trim());
    put('stands', f.stands);
    put('marks', f.marks);
    put('below', f.below ? '1' : '');
    put('cls', f.cls);
    if (u.toString() !== window.location.href) window.history.replaceState(null, '', u.toString());
  }, [f]);
  const visible = useMemo(() => {
    const t = f.q.trim().toLowerCase();
    return new Set(
      items
        .filter(
          (x) =>
            (!t || x.text.includes(t) || x.roll === t) &&
            (!f.stands || x.stands === f.stands) &&
            (!f.marks || (f.marks === 'absent' ? x.absent : !x.marked)) &&
            (!f.below || x.below) &&
            (!f.cls || x.classId === f.cls),
        )
        .map((x) => x.id),
    );
  }, [items, f]);
  const value = useMemo(
    () => ({
      f,
      set: (p: Partial<Filters>) => setF((cur) => ({ ...cur, ...p })),
      visible,
      items,
      classes,
    }),
    [f, visible, items, classes],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The search box and the quick filters, with how many show. */
export function SlotFilterBar() {
  const ctx = useSlotFilter();
  if (!ctx) return null;
  const { f, set, visible, items, classes } = ctx;
  const any = f.q.trim() || f.stands || f.marks || f.below || f.cls;
  const chip = (on: boolean, label: string, click: () => void) => (
    <button
      key={label}
      type="button"
      className={`ep-btn ep-btn--sm ${on ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
      aria-pressed={on}
      onClick={click}
    >
      {label}
    </button>
  );
  return (
    <div
      className="ep-card"
      role="search"
      aria-label="Find candidates of the slot"
      style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'end' }}>
        <label className="ep-field" style={{ flex: '1 1 16rem', margin: 0 }}>
          <span className="ep-field__label">Search</span>
          <input
            className="ep-input"
            type="search"
            maxLength={80}
            placeholder="Name, registration or roll no."
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </label>
        {classes.length > 1 ? (
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Class</span>
            <select
              className="ep-select"
              value={f.cls}
              onChange={(e) => set({ cls: e.target.value })}
            >
              <option value="">Every class</option>
              {classes.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p role="status" style={{ margin: 0 }}>
          Showing {visible.size} of {items.length}
        </p>
        {any ? (
          <button
            type="button"
            className="ep-btn ep-btn--ghost ep-btn--sm"
            onClick={() => set(EMPTY)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
        <div
          role="group"
          aria-label="Stands"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}
        >
          {STANDS.map(([v, label]) => chip(f.stands === v, label, () => set({ stands: v })))}
        </div>
        <div
          role="group"
          aria-label="Marks"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}
        >
          {MARKS.map(([v, label]) =>
            chip(f.marks === v, v ? label : 'Any marks', () => set({ marks: v })),
          )}
          {chip(f.below, 'Below cut-off', () => set({ below: !f.below }))}
        </div>
      </div>
    </div>
  );
}
