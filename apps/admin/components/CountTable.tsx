import type { Count } from '@/lib/people-dashboard';

/** A small two-column table of counts with each row's share of the total. */
export function CountTable({
  caption,
  rows,
  total,
}: {
  caption: string;
  rows: Count[];
  total: number;
}) {
  return (
    <table className="ep-table ep-table--dense">
      <caption className="ep-sr-only">{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>
              <strong>{r.key}</strong>
            </td>
            <td>{r.n}</td>
            <td className="ep-field__help">
              {total ? `${String(Math.round((r.n / total) * 100))}%` : ''}
            </td>
          </tr>
        ))}
        {!rows.length ? (
          <tr>
            <td>—</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
