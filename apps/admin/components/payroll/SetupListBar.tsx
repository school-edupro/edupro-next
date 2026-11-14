import { Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import type { SetupList, SetupListNav } from '@/lib/payroll-lists';

/**
 * A payroll set-up list's frame: its filters (a form that keeps the rest of the address), records per page,
 * "Showing a – b of N", Excel and PDF of every row the filters leave, the rows (children), then the pages.
 */
export function SetupListBar<R>({
  list,
  nav,
  id,
  children,
}: {
  list: SetupList<R>;
  nav: SetupListNav;
  /** a short id for the form's fields (unique on the page) */
  id: string;
  children?: React.ReactNode;
}) {
  const filtered = Object.keys(nav.values).length > 0;
  return (
    <>
      {list.filters.length ? (
        <form
          className="ep-filter-band"
          method="get"
          action={nav.path}
          aria-label={`Filter the ${list.noun}`}
        >
          {nav.keep.map(([k, v]) => (
            <input key={`${k}=${v}`} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name={`${nav.prefix}size`} value={String(list.size)} />
          {list.filters.map((f) => {
            const fid = `${id}-${f.key}`;
            const name = `${nav.prefix}${f.key}`;
            const value = nav.values[f.key] ?? '';
            return (
              <label key={f.key} className="ep-field" htmlFor={fid}>
                <span className="ep-field__label">{f.label}</span>
                {f.kind === 'select' ? (
                  <select id={fid} name={name} className="ep-select" defaultValue={value}>
                    <option value="">All</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={fid}
                    name={name}
                    type={f.kind === 'date' ? 'date' : 'search'}
                    className="ep-input"
                    defaultValue={value}
                    maxLength={100}
                  />
                )}
              </label>
            );
          })}
          <button type="submit" className="ep-btn ep-btn--primary">
            Show
          </button>
          {filtered ? (
            <a className="ep-btn ep-btn--secondary" href={nav.clearHref}>
              Clear
            </a>
          ) : null}
        </form>
      ) : null}
      <div className="ep-listbar">
        <SizeLinks size={list.size} sizeHref={nav.sizeHref} noun={`${id} ${list.noun}`} />
        <div className="ep-listbar__end">
          <Showing page={list.page} size={list.size} total={list.total} />
          {list.total ? (
            <>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={nav.files.xlsx} download>
                Excel<span className="ep-sr-only"> of the {list.noun}</span>
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={nav.files.pdf} download>
                PDF<span className="ep-sr-only"> of the {list.noun}</span>
              </a>
            </>
          ) : null}
        </div>
      </div>
      {children}
      {filtered && list.total < list.all ? (
        <p className="ep-field__help">
          {list.total} of {list.all} {list.noun} match the filters.
        </p>
      ) : null}
      <Pages
        page={list.page}
        size={list.size}
        total={list.total}
        href={nav.href}
        noun={`${id} ${list.noun}`}
      />
    </>
  );
}

/** Only the Excel and PDF of a list (for a table that is a form saved whole, such as the nominees). */
export function SetupListFiles<R>({ list, nav }: { list: SetupList<R>; nav: SetupListNav }) {
  if (!list.total) return null;
  return (
    <p className="ep-grid__toolbar" style={{ justifyContent: 'flex-end' }}>
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={nav.files.xlsx} download>
        Excel<span className="ep-sr-only"> of the {list.noun}</span>
      </a>
      <a className="ep-btn ep-btn--secondary ep-btn--sm" href={nav.files.pdf} download>
        PDF<span className="ep-sr-only"> of the {list.noun}</span>
      </a>
    </p>
  );
}
