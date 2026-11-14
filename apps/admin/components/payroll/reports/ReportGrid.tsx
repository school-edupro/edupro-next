import { Card } from '@edupro/ui';

export interface GridCol {
  key: string;
  label: string;
  kind?: 'money' | 'number' | 'text';
}
export type GridRow = Record<string, string | number | null>;
export interface Grid {
  key: string;
  title: string;
  period: string;
  subtitle: string[];
  columns: GridCol[];
  rows: GridRow[];
  subtotals: Array<{ label: string; row: GridRow }>;
  total: GridRow | null;
  provisional: string | null;
  after?: Array<{ title: string; columns: GridCol[]; rows: GridRow[] }>;
  note?: string;
}

const show = (c: GridCol, v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? ''
    : c.kind === 'money'
      ? Number(String(v)).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : String(v);
const right = (c: GridCol) =>
  c.kind === 'money' || c.kind === 'number' ? { textAlign: 'right' as const } : undefined;

function Table({
  id,
  cols,
  rows,
  extra,
}: {
  id: string;
  cols: GridCol[];
  rows: GridRow[];
  extra?: GridRow[];
}) {
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby={id}>
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" style={right(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(i)}>
              {cols.map((c) => (
                <td key={c.key} style={right(c)}>
                  {show(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {(extra ?? []).map((r, i) => (
            <tr key={`x${String(i)}`}>
              {cols.map((c) => (
                <td key={c.key} style={right(c)}>
                  <strong>{show(c, r[c.key])}</strong>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A report's grid as the screen shows it — the same rows, sub-totals and total the downloads carry. */
export function ReportGrid({ g }: { g: Grid }) {
  return (
    <>
      {g.provisional ? (
        <p className="ep-alert ep-alert--warning" role="status">
          {g.provisional}
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="rp-grid">
        <h2 id="rp-grid" className="ep-card__title">
          {g.title} · {g.period}
        </h2>
        {g.subtitle.map((s) => (
          <p key={s} className="ep-field__help" style={{ marginTop: 0 }}>
            {s}
          </p>
        ))}
        {g.rows.length ? (
          <Table
            id="rp-grid"
            cols={g.columns}
            rows={g.rows}
            extra={[...g.subtotals.map((s) => s.row), ...(g.total ? [g.total] : [])]}
          />
        ) : (
          <p>Nothing to show for this choice.</p>
        )}
        {g.note ? <p className="ep-field__help">{g.note}</p> : null}
      </section>
      {(g.after ?? []).map((a, i) => (
        <Card key={a.title} title={a.title}>
          <span id={`rp-after-${String(i)}`} className="ep-sr-only">
            {a.title}
          </span>
          <Table id={`rp-after-${String(i)}`} cols={a.columns} rows={a.rows} />
        </Card>
      ))}
    </>
  );
}
