import type { AnColumn, AnTable } from '@/lib/board-results';

/** The heading groups of a table, in order: a label over a run of columns, or a column of its own. */
function groupsOf(columns: AnColumn[]) {
  const out: Array<{ group: string | null; cols: AnColumn[] }> = [];
  for (const c of columns) {
    const last = out[out.length - 1];
    if (c.group && last && last.group === c.group) last.cols.push(c);
    else out.push({ group: c.group ?? null, cols: [c] });
  }
  return out;
}

/** A wide table with heading groups (Boys / Girls under each range) and a bold total line. */
export function GroupedTable({
  t,
  label,
  freeze,
}: {
  t: AnTable;
  label: string;
  /** the first columns that stay in view while the rest scrolls sideways */
  freeze?: 2 | 3;
}) {
  const groups = groupsOf(t.columns);
  const strong = new Set(t.strong ?? []);
  const show = (v: string | number | null | undefined, c: AnColumn) =>
    v === null || v === undefined
      ? c.num
        ? '—'
        : ''
      : c.label === '%' && typeof v === 'number'
        ? `${String(v)}%`
        : String(v);
  return (
    <div className={`ep-table-tight${freeze ? ` ep-table-freeze-${String(freeze)}` : ''}`}>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={label}>
        <table className="ep-table" data-density="dense">
          <caption className="ep-sr-only">{label}</caption>
          <thead>
            <tr>
              {groups.map((g, i) =>
                g.group ? (
                  <th key={`g${String(i)}`} scope="colgroup" colSpan={g.cols.length}>
                    {g.group}
                  </th>
                ) : (
                  <th
                    key={g.cols[0]!.key}
                    scope="col"
                    rowSpan={2}
                    style={g.cols[0]!.num ? { textAlign: 'right' } : undefined}
                  >
                    {g.cols[0]!.label}
                  </th>
                ),
              )}
            </tr>
            <tr>
              {groups
                .filter((g) => g.group)
                .flatMap((g) =>
                  g.cols.map((c) => (
                    <th key={c.key} scope="col" style={{ textAlign: 'right' }}>
                      {c.label}
                    </th>
                  )),
                )}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={String(i)}>
                {t.columns.map((c) => {
                  const v = show(r[c.key], c);
                  return (
                    <td key={c.key} style={c.num ? { textAlign: 'right' } : undefined}>
                      {strong.has(i) ? <strong>{v}</strong> : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
