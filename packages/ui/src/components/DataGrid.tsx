'use client';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

export interface DataGridColumn<T> {
  key: string;
  header: string;
  /** Value used for sorting and filtering; defaults to row[key]. */
  accessor?: (row: T) => unknown;
  /** Cell renderer; defaults to the accessor value as text. */
  render?: (row: T) => ReactNode;
  numeric?: boolean;
  sortable?: boolean;
  /** Hidden until the reader adds it through the column chooser. */
  hidden?: boolean;
}

export interface DataGridProps<T> {
  /** Stable id; saved views are stored per id in localStorage. */
  id: string;
  columns: Array<DataGridColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  pageSize?: number;
  density?: 'normal' | 'dense';
  emptyTitle?: string;
  emptyHint?: ReactNode;
  /** Extra controls rendered in the toolbar (filters, actions). */
  toolbar?: ReactNode;
  searchable?: boolean;
}

interface SavedView {
  visibility: VisibilityState;
  sorting: SortingState;
  density: 'normal' | 'dense';
  filter: string;
}

const storageKey = (id: string) => `edupro.grid.${id}`;

function readViews(id: string): Record<string, SavedView> {
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as Record<string, SavedView>) : {};
  } catch {
    return {};
  }
}

function writeViews(id: string, views: Record<string, SavedView>): void {
  try {
    window.localStorage.setItem(storageKey(id), JSON.stringify(views));
  } catch {
    // storage may be unavailable (private mode); views are a convenience only
  }
}

/**
 * Design-system data grid (S3-05): sorting, text filter, column chooser, density and saved views on top of
 * TanStack Table. Server pages hand it the rows; it never fetches. Keyboard: headers are buttons, the
 * chooser is a native disclosure, pagination uses buttons.
 */
export function DataGrid<T>({
  id,
  columns,
  rows,
  rowKey,
  caption,
  pageSize = 25,
  density: initialDensity = 'normal',
  emptyTitle = 'Nothing here yet',
  emptyHint,
  toolbar,
  searchable = true,
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const [density, setDensity] = useState<'normal' | 'dense'>(initialDensity);
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.key, false])),
  );
  const [views, setViews] = useState<Record<string, SavedView>>({});
  const [currentView, setCurrentView] = useState('');

  useEffect(() => {
    setViews(readViews(id));
  }, [id]);

  const defs = useMemo<Array<ColumnDef<T, unknown>>>(
    () =>
      columns.map((c) => ({
        id: c.key,
        header: c.header,
        accessorFn: c.accessor ?? ((row: T) => (row as Record<string, unknown>)[c.key]),
        cell: (info) => (c.render ? c.render(info.row.original) : String(info.getValue() ?? '')),
        enableSorting: c.sortable !== false,
        sortDescFirst: false, // first press sorts ascending for every column, numbers included
        meta: { numeric: c.numeric === true },
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: filter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    getRowId: (row) => rowKey(row),
    globalFilterFn: 'includesString',
  });

  const applyView = (name: string) => {
    setCurrentView(name);
    const v = views[name];
    if (!v) return;
    setVisibility(v.visibility);
    setSorting(v.sorting);
    setDensity(v.density);
    setFilter(v.filter);
  };
  const saveView = () => {
    const name = window.prompt('Name this view', currentView || 'My view');
    if (!name) return;
    const next = { ...views, [name]: { visibility, sorting, density, filter } };
    setViews(next);
    writeViews(id, next);
    setCurrentView(name);
  };
  const deleteView = () => {
    if (!currentView) return;
    const next = { ...views };
    delete next[currentView];
    setViews(next);
    writeViews(id, next);
    setCurrentView('');
  };

  const total = table.getFilteredRowModel().rows.length;
  const pageRows = table.getRowModel().rows;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div className="ep-grid" data-density={density}>
      <div className="ep-grid__toolbar">
        {searchable ? (
          <label className="ep-grid__search">
            <span className="ep-field__label">Search</span>
            <input
              className="ep-input"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type to filter rows"
              aria-label={`Search ${caption}`}
            />
          </label>
        ) : null}
        {toolbar}
        <div className="ep-grid__spacer" />
        <details className="ep-grid__chooser">
          <summary className="ep-btn ep-btn--secondary ep-btn--sm">Columns</summary>
          <div className="ep-grid__popover" role="group" aria-label="Choose columns">
            {table.getAllLeafColumns().map((col) => (
              <label key={col.id} className="ep-check" htmlFor={`${id}-col-${col.id}`}>
                <input
                  id={`${id}-col-${col.id}`}
                  type="checkbox"
                  className="ep-check__input"
                  checked={col.getIsVisible()}
                  onChange={col.getToggleVisibilityHandler()}
                />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">{String(col.columnDef.header)}</span>
              </label>
            ))}
          </div>
        </details>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          aria-pressed={density === 'dense'}
          onClick={() => setDensity(density === 'dense' ? 'normal' : 'dense')}
        >
          {density === 'dense' ? 'Comfortable' : 'Dense'}
        </button>
        <label className="ep-grid__views">
          <span className="ep-field__label">View</span>
          <select
            className="ep-select"
            value={currentView}
            onChange={(e) => applyView(e.target.value)}
            aria-label="Saved views"
          >
            <option value="">Default</option>
            {Object.keys(views).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={saveView}>
          Save view
        </button>
        {currentView ? (
          <button type="button" className="ep-btn ep-btn--ghost ep-btn--sm" onClick={deleteView}>
            Delete view
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
          <div className="ep-empty">
            <div className="ep-empty__title">
              {rows.length === 0 ? emptyTitle : 'No rows match the filter'}
            </div>
            {rows.length === 0 ? emptyHint : null}
          </div>
        </div>
      ) : (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
          <table className="ep-table" data-density={density}>
            <caption style={{ position: 'absolute', left: '-9999px' }}>{caption}</caption>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const numeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)
                      ?.numeric;
                    const sorted = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        scope="col"
                        className={numeric ? 'is-numeric' : undefined}
                        aria-sort={
                          sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                        }
                      >
                        {h.column.getCanSort() ? (
                          <button
                            type="button"
                            className="ep-grid__sort"
                            onClick={h.column.getToggleSortingHandler()}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <span aria-hidden="true" className="ep-grid__sort-icon">
                              {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : ''}
                            </span>
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const numeric = (
                      cell.column.columnDef.meta as { numeric?: boolean } | undefined
                    )?.numeric;
                    return (
                      <td key={cell.id} className={numeric ? 'is-numeric' : undefined}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ep-grid__footer">
        <span className="ep-grid__count" aria-live="polite">
          {total} row{total === 1 ? '' : 's'}
          {filter ? ` (filtered from ${rows.length})` : ''}
        </span>
        {pageCount > 1 ? (
          <nav className="ep-grid__pager" aria-label="Pagination">
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </button>
            <span>
              Page {pageIndex + 1} of {pageCount}
            </span>
            <button
              type="button"
              className="ep-btn ep-btn--ghost ep-btn--sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
