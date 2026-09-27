import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  density?: 'normal' | 'dense';
  emptyTitle?: string;
  emptyHint?: ReactNode;
  caption?: string;
}

/**
 * Minimal accessible table for Sprint 0 to 2 screens. The TanStack-based table with sorting, filters,
 * column chooser and saved views replaces it in Sprint 3 while keeping this API.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  density = 'normal',
  emptyTitle = 'Nothing here yet',
  emptyHint,
  caption,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="ep-table-wrap">
        <div className="ep-empty">
          <div className="ep-empty__title">{emptyTitle}</div>
          {emptyHint}
        </div>
      </div>
    );
  }
  return (
    <div className="ep-table-wrap">
      <table className="ep-table" data-density={density}>
        {caption ? (
          <caption style={{ position: 'absolute', left: '-9999px' }}>{caption}</caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'is-numeric' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'is-numeric' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
