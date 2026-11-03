import type { Sheet, SheetCell } from '@edupro/ui';
import { CountDrill } from '@/components/exams/CountDrill';

/**
 * A register's sheet as a table (docs/design/68): the two heading rows (each subject over its columns),
 * a row per student, the class average at the foot. Worked-out cells are tinted green, the final
 * amber, codes in red; the student's name stays in view while the sheet scrolls. A report's count
 * opens the list of the students it stands for.
 */
export function RegisterSheet({ sheet, label }: { sheet: Sheet; label: string }) {
  const nameAt = sheet.head[0]?.findIndex((h) => h.t === 'Student') ?? -1;
  const attrs = (c: SheetCell, i: number) => ({
    'data-tone': c.tone,
    'data-text': c.text ? 'true' : undefined,
    'data-lines': c.lines ? 'true' : undefined,
    'data-frozen': i === nameAt ? 'true' : undefined,
    'data-align': c.center ? 'center' : undefined,
    'data-strong': c.strong ? 'true' : undefined,
    'data-wrap': c.wrap ? 'true' : undefined,
    title: c.title,
  });
  return (
    <div className="ep-mr-sheet-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="ep-mr-sheet">
        <caption className="ep-sr-only">{label}</caption>
        <thead>
          {sheet.head.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <th
                  key={i}
                  scope={c.span && c.span > 1 ? 'colgroup' : 'col'}
                  colSpan={c.span}
                  rowSpan={c.rows}
                  {...attrs(c, r === 0 ? i : -1)}
                >
                  {c.t}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {sheet.body.map((row) => (
            <tr key={row.studentId}>
              {row.cells.map((c, i) =>
                i === nameAt ? (
                  <th key={i} scope="row" {...attrs(c, i)}>
                    {c.t}
                  </th>
                ) : (
                  <td key={i} colSpan={c.span} {...attrs(c, i)}>
                    <CellBody c={c} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {sheet.foot ? (
          <tfoot>
            <tr>
              {sheet.foot.map((c, i) => (
                <td key={i} colSpan={c.span} {...attrs(c, i)}>
                  {c.t}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** a cell: its text, a status badge, and a count that opens its students */
function CellBody({ c }: { c: SheetCell }) {
  const tone = {
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    neutral: 'neutral',
    info: 'info',
  } as const;
  if (c.drill && !c.badge) return <CountDrill label={c.drillLabel ?? c.t} drill={c.drill} />;
  // "681 / 700": the obtained in bold, the maximum muted
  const ratio = c.ratio ? /^(.+) \/ (.+)$/.exec(c.t) : null;
  return (
    <>
      {ratio ? (
        <>
          <strong>{ratio[1]}</strong> <span className="ep-mr-muted">/ {ratio[2]}</span>
        </>
      ) : (
        c.t
      )}
      {c.badge ? (
        <span className={`ep-badge ep-badge--${tone[c.badge.tone]} ep-mr-badge`}>
          {c.badge.label}
        </span>
      ) : null}
      {c.drill ? (
        <span className="ep-mr-drill-line">
          <CountDrill label={c.drillLabel ?? c.t} drill={c.drill} />
        </span>
      ) : null}
    </>
  );
}
