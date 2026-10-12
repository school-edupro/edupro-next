import type { ReactNode } from 'react';

/** What a register page reads from the address bar, checked before it goes to the API. */
export function registerQuery(
  sp: Record<string, string | undefined>,
  allowed: { status?: string[]; kind?: string[]; mode?: string[] },
) {
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : '');
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const one = (v: string | undefined, list?: string[]) => (v && list?.includes(v) ? v : '');
  const size = ['25', '50', '100', '200'].includes(sp.size ?? '') ? sp.size! : '50';
  const values = {
    status: one(sp.status, allowed.status),
    kind: one(sp.kind, allowed.kind),
    mode: one(sp.mode, allowed.mode),
    classId: id(sp.classId),
    from: day(sp.from),
    to: day(sp.to),
    q: (sp.q ?? '').trim().slice(0, 80),
  };
  // the filters as the API takes them: the list and the Excel / PDF files use the same
  const filters = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v) filters.set(k, v);
  const list = new URLSearchParams(filters);
  list.set('size', size);
  list.set('page', String(Math.max(1, Number(sp.page) || 1)));
  // links to another page (or tab) keep what was chosen on the screen
  const here = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over }))
      if (v && !['ok', 'error', 'detail'].includes(k)) u.set(k, String(v));
    return u.toString();
  };
  return { values, size, filters, list, here };
}

/** The filter row of a register: the fields, then Apply and Clear. */
export function FilterRow({
  children,
  clearHref,
  hidden,
}: {
  children: ReactNode;
  clearHref: string;
  /** Kept across Apply (the tab of the page). */
  hidden?: Record<string, string>;
}) {
  return (
    <form
      method="get"
      style={{
        display: 'flex',
        gap: 'var(--sp-3)',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
        marginBottom: 'var(--sp-4)',
      }}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button type="submit" className="ep-btn ep-btn--secondary">
        Apply
      </button>
      <a className="ep-btn ep-btn--ghost" href={clearHref}>
        Clear
      </a>
    </form>
  );
}

/** A date or text box of the filter row. */
export function FilterInput({
  id,
  label,
  type = 'text',
  value,
}: {
  id: string;
  label: string;
  type?: 'text' | 'date';
  value: string;
}) {
  return (
    <label className="ep-field" htmlFor={id} style={{ margin: 0 }}>
      <span className="ep-field__label">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        className="ep-input"
        defaultValue={value}
        maxLength={80}
      />
    </label>
  );
}

/** "Showing x–y of n", the totals of what is filtered, and the Excel / PDF buttons. */
export function RegisterBar({
  page,
  size,
  total,
  summary,
  fileHref,
}: {
  page: number;
  size: number;
  total: number;
  summary?: string;
  /** The address of the file route with the filters; `format` is added here. */
  fileHref: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        marginBottom: 'var(--sp-3)',
      }}
    >
      <span className="ep-field__help" aria-live="polite">
        {total
          ? `Showing ${String((page - 1) * size + 1)}–${String(Math.min(page * size, total))} of ${String(total)}`
          : 'No records'}
        {summary ? ` · ${summary}` : ''}
      </span>
      <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${fileHref}&format=xlsx`}>
          Excel
        </a>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${fileHref}&format=pdf`}>
          PDF
        </a>
      </span>
    </div>
  );
}

export function Pager({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label="Pages"
      style={{
        display: 'flex',
        gap: 'var(--sp-3)',
        alignItems: 'center',
        marginTop: 'var(--sp-3)',
      }}
    >
      {page > 1 ? (
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={hrefFor(page - 1)}>
          ← Previous
        </a>
      ) : null}
      <span className="ep-field__help">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={hrefFor(page + 1)}>
          Next →
        </a>
      ) : null}
    </nav>
  );
}

export const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
